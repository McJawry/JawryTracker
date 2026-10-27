<script lang="ts">
  // Ported from renderSphereBoard() (dev/app/app.js:3393+) plus
  // renderSpherePredictionColumns() (dev/app/app.js:4192+): Start, per-sphere
  // placement lists, available-locations-by-area groups (with boss-path
  // icons), and the "Sphere ?" relative-unknown columns that hold placements
  // the logic can't pin to a numbered sphere.
  //
  // Path hints get a card in whichever column their boss resolves to, or a
  // "Paths" column when nothing reaches it yet (sphere-path-progress.ts).
  //
  // Still deferred: SVG dependency-line drawing between columns, and the
  // candidate-item row under each path card. The original's autosave nodes
  // are the unplaced-item cards in the "Sphere ?" column here (the knowledge
  // calls them unknownSourceItems).
  import { WWRSphereEngine } from "$lib/logic";
  import type { SpherePlacement } from "$lib/state/sphere.svelte";
  import { data } from "$lib/state/data.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { getSphereTrackingKnowledge } from "$lib/logic/sphere-tracking-knowledge";
  import { getSphereBoardAnalysis, registerSphereBoardViewer } from "$lib/logic/sphere-worker-client.svelte";
  import { sphereAnalysisCache } from "$lib/state/sphere-analysis.svelte";
  import { isLocationMarked } from "$lib/logic/locations";
  import { getAreaFromLocation } from "$lib/logic/data-loading";
  import { getUnplacedAcquiredItems } from "$lib/logic/unplaced-items";
  import { combineHiddenPlacementIds, isSphereFilterActive } from "$lib/logic/sphere-usefulness";
  import type { PathProgressEntry } from "$lib/logic/sphere-path-progress";
  import SpherePlacementNode from "./SpherePlacementNode.svelte";
  import SphereAreaGroup from "./SphereAreaGroup.svelte";
  import SphereUnplacedItemNode from "./SphereUnplacedItemNode.svelte";
  import SpherePathPredictionNode from "./SpherePathPredictionNode.svelte";
  import SphereAreaHintNode from "./SphereAreaHintNode.svelte";
  import { shouldExpandSphereGroups, toggleAllSphereGroups } from "$lib/state/sphere-groups.svelte";
  import { drawSphereEdges, applySphereChainFocus } from "./sphere-edges";

  const normalize = WWRSphereEngine.normalize;

  // getSphereTrackingKnowledge() is pure (no side effects), safe for $derived.
  const knowledge = $derived(getSphereTrackingKnowledge());

  // getSphereBoardAnalysis() is NOT pure - it mutates sphereAnalysisCache and
  // dispatches worker jobs as a side effect, so it belongs in $effect, not
  // $derived. $derived bodies are expected to be pure and can be re-run more
  // than once per logical update; calling a side-effecting function from one
  // risks runaway repeated dispatches. sphereAnalysisCache is itself reactive
  // state, so components below read it directly rather than through this
  // effect's return value.
  $effect(() => {
    getSphereBoardAnalysis(knowledge);
  });

  // Asks this window's analysis to include the board's half - boss icons, path
  // cards, the Filters menu's walk - which a window without a board skips.
  $effect(() => registerSphereBoardViewer());

  const calculation = $derived(sphereAnalysisCache.calculation);

  const placementByLocation = $derived(new Map(knowledge.placements.map((placement) => [normalize(placement.location), placement])));

  // Everything below that comes from the logic was worked out in the analysis
  // worker beside the calculation (sphere-board-analysis.ts); the board only
  // lays it out. Until a run lands it shows the previous one's, the same as the
  // calculation it belongs to.
  const boardAnalysis = $derived(sphereAnalysisCache.board);
  const pathBossIconsByLocation = $derived(
    (settings.showPathIcons && boardAnalysis?.pathBossIcons) || new Map<string, string[]>()
  );

  interface SphereColumnData {
    sphereNumber: number;
    placements: Array<{ location: string; placement: ReturnType<typeof placementFor> }>;
    groups: Array<{ area: string; locations: string[] }>;
  }
  function placementFor(location: string) {
    return placementByLocation.get(normalize(location));
  }

  function groupLocationsByArea(locations: string[]): Array<{ area: string; locations: string[] }> {
    const groupsByArea = new Map<string, string[]>();
    locations.forEach((location) => {
      const area = getAreaFromLocation(location);
      if (!groupsByArea.has(area)) groupsByArea.set(area, []);
      groupsByArea.get(area)!.push(location);
    });
    return [...groupsByArea.entries()].map(([area, grouped]) => ({ area, locations: grouped }));
  }

  let columnsElement: HTMLDivElement | undefined = $state();
  let edgesElement: SVGSVGElement | undefined = $state();

  function setChainFocus(target: HTMLElement | null): void {
    const node = target?.closest?.<HTMLElement>("[data-node-id]");
    applySphereChainFocus(columnsElement ?? null, edgesElement ?? null, node?.dataset.nodeId ?? "");
  }

  /**
   * Edges are redrawn from what the DOM actually contains, driven by a
   * MutationObserver rather than by listing reactive dependencies: the cards
   * come from several $derived collections and a bare `sphereColumns;`
   * statement is not a dependency the compiler keeps, so the effect silently
   * never re-ran. Watching the container also covers things no derived value
   * expresses - an area group being expanded, or a card resizing.
   */
  $effect(() => {
    const canvas = columnsElement;
    const edges = edgesElement;
    // Read here so a zoom change tears down and re-runs this effect.
    const zoom = settings.sphereBoardZoom / 100;
    if (!canvas || !edges) return;

    // Two frames: the first lands after Svelte's DOM update, the second after
    // the browser has laid it out. Measuring in between anchored edges to the
    // previous render's positions.
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          // The draw decides which cards are purple, so it is also what tells
          // the Filters menu what "Paths" should keep. Only republish on a real
          // change, or hiding cards would redraw and loop.
          const { chain, potential } = drawSphereEdges(canvas, edges, zoom);
          const changed = (next: Set<string>, current: Set<string>) =>
            next.size !== current.size || [...next].some((id) => !current.has(id));
          if (changed(chain, pathChainNodeIds)) pathChainNodeIds = chain;
          if (changed(potential, potentialPathNodeIds)) potentialPathNodeIds = potential;
        });
      });
    };
    redraw();

    const mutations = new MutationObserver((records) => {
      // Ignore our own writes into the <svg>, or drawing would retrigger
      // drawing forever.
      if (records.every((record) => edges.contains(record.target))) return;
      redraw();
    });
    mutations.observe(canvas, {
      childList: true,
      subtree: true,
      attributes: true,
      // "hidden": the Locations toggle hides the area groups in place.
      attributeFilter: ["open", "data-dependencies", "hidden"]
    });
    const resize = new ResizeObserver(redraw);
    resize.observe(canvas);

    // requestAnimationFrame does not fire while the document is hidden, so a
    // popout that is minimised or behind another window would come back with
    // no lines and nothing to trigger them - the observers only fire if
    // something actually changed while it was away.
    const onVisible = () => { if (!document.hidden) redraw(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  const pathProgress = $derived<PathProgressEntry[]>(calculation ? (boardAnalysis?.pathProgress ?? []) : []);

  const pathsBySphere = $derived.by(() => {
    const map = new Map<number, PathProgressEntry[]>();
    pathProgress.forEach((entry) => {
      if (entry.progress.kind !== "exact") return;
      const list = map.get(entry.progress.sphere) ?? [];
      list.push(entry);
      map.set(entry.progress.sphere, list);
    });
    return map;
  });

  const pathsByLevel = $derived.by(() => {
    const map = new Map<number, PathProgressEntry[]>();
    pathProgress.forEach((entry) => {
      if (entry.progress.kind !== "relative") return;
      const list = map.get(entry.progress.level) ?? [];
      list.push(entry);
      map.set(entry.progress.level, list);
    });
    return map;
  });

  const unresolvedPaths = $derived(pathProgress.filter((entry) => entry.progress.kind === "unknown"));

  // Which cards each path hint's purple chain runs back from, keyed by hint
  // line so the card components can publish it as data-path-source-ids.
  const pathSourceIds = $derived(boardAnalysis?.pathSourceIds ?? new Map<number, string[]>());

  // Filters menu: cards to hide. The requirement walk - a reachability pass
  // per item - came back from the worker with the rest of the analysis; what
  // is left is set arithmetic against the purple chain, cheap enough to redo
  // whenever the chain is redrawn.
  //
  // A card placed since that walk ran has not been judged yet, so it stays in
  // view until the next result lands - and with no walk yet, every card does.
  // Published by drawSphereEdges - the cards it painted purple, and the ones
  // that could still join a path (see potentialPathNodes there).
  let pathChainNodeIds = $state(new Set<string>());
  let potentialPathNodeIds = $state(new Set<string>());
  const hiddenPlacementIds = $derived.by((): Set<string> => {
    const filters = settings.sphereFilters;
    if (!isSphereFilterActive(filters)) return new Set();
    const requiredIds = boardAnalysis?.requiredPlacementIds;
    if (filters.pathsAndRequired && !requiredIds) return new Set();
    const evaluated = boardAnalysis?.evaluatedPlacementIds;
    const placements = filters.pathsAndRequired && evaluated
      ? knowledge.placements.filter((placement) => evaluated.has(placement.id))
      : knowledge.placements;
    return combineHiddenPlacementIds({
      placements,
      filters,
      pathChainIds: [...pathChainNodeIds],
      potentialPathIds: [...potentialPathNodeIds],
      sphereLocations: calculation?.sphereLocations,
      prunedPlacementIds: calculation?.prunedPlacementIds ?? [],
      playthroughFinished: Boolean(calculation?.prunedAgainstGoal),
      requiredIds: requiredIds ?? []
    });
  });

  // Cards the Filters menu hides still sit on the board, out of sight. Which
  // cards are purple is read off the board's own lines (drawSphereEdges), so a
  // card left out of the DOM could never turn purple: a newly found item stayed
  // hidden for good, as did a hidden card a later find put on a path, until the
  // filter was switched off and on again.
  const filteredPlacements = $derived(
    knowledge.placements
      .filter((placement) => hiddenPlacementIds.has(placement.id))
      .map((placement) => {
        // The same split the columns make: a numbered sphere hangs off the
        // calculation's dependencies, anything else off the inferred ones.
        const sphere = calculation?.locationSpheres[normalize(placement.location)];
        return { placement, sphereNumber: Number.isInteger(sphere) ? (sphere as number) : null };
      })
  );

  const sphereColumns = $derived.by((): SphereColumnData[] => {
    if (!calculation) return [];
    const columns: SphereColumnData[] = [];
    calculation.sphereLocations.forEach((sphereLocations, sphereNumber) => {
      if (!sphereLocations?.length) return;
      const placements = sphereLocations.filter(
        (location) => placementByLocation.has(normalize(location)) && !hiddenPlacementIds.has(placementFor(location)?.id ?? "")
      );
      const openLocations = sphereLocations.filter((location) => !placementByLocation.has(normalize(location)) && !isLocationMarked(location));
      // A solved path card counts as content: without this, a sphere whose
      // placements were all made and whose locations were all checked lost
      // its column - taking the boss card that resolved to it with it.
      const solvedPathHints = pathsBySphere.get(sphereNumber) ?? [];
      if (!placements.length && !openLocations.length && !solvedPathHints.length) return;

      columns.push({
        sphereNumber,
        placements: placements.map((location) => ({ location, placement: placementFor(location) })),
        groups: groupLocationsByArea(openLocations)
      });
    });
    return columns;
  });

  interface PredictionColumnData {
    level: number;
    heading: string;
    placements: SpherePlacement[];
    groups: Array<{ area: string; locations: string[] }>;
  }

  // The relative-unknown columns. A placement whose location the logic can't
  // reach - an out-of-logic check, or one gated behind something not yet
  // known - gets no sphere number, so it appears in none of the numbered
  // columns above. Without these it would vanish from the board entirely.
  //
  // Levels are relative order, not absolute spheres: level 0 is "as soon as
  // the unknown resolves", level N is N dependency steps after that.
  // Acquired-but-unassigned items share the level-0 column: they're known to
  // be held, but nothing pins them to a sphere.
  const unplacedItems = $derived(getUnplacedAcquiredItems());

  // Acquired shards and area hints are sources the inference already uses;
  // these give them cards, so the graph edges drawn to them land on something
  // visible. Both belong to the unknown-sphere column, as upstream.
  const occupiedLocationKeys = $derived(new Set(knowledge.placements.map((p) => normalize(p.location))));


  // Path hints get a card wherever their boss lands: a numbered sphere, one of
  // the relative-unknown columns, or the Paths column when nothing reaches it
  // yet.

  // What each location in the relative columns waits on. Those locations have
  // no sphere, so the calculation's dependencies say nothing about them: their
  // area groups sat unconnected, and a branch that only led there looked
  // finished to the Paths filter.
  const relativeAvailableDependencies = $derived(
    Object.fromEntries(sphereAnalysisCache.relativeUnknown?.availableDependencies ?? []) as Record<string, string[]>
  );

  const predictionColumns = $derived.by((): PredictionColumnData[] => {
    const relativeUnknown = sphereAnalysisCache.relativeUnknown;
    if (!calculation || !relativeUnknown) return [];

    const maxLevel = Math.max(
      0,
      ...relativeUnknown.placementLevels.values(),
      ...relativeUnknown.availableLocationLevels.values(),
      ...pathsByLevel.keys()
    );
    const columns: PredictionColumnData[] = [];

    for (let level = 0; level <= maxLevel; level += 1) {
      const placements = relativeUnknown.unresolvedPlacements.filter(
        (placement) => (relativeUnknown.placementLevels.get(placement.id) || 0) === level && !hiddenPlacementIds.has(placement.id)
      );
      // Each available location sits in the column for whatever unlocks it,
      // rather than all landing in level 0 - see availableLocationLevels.
      const availableLocations = (relativeUnknown.availableLocations ?? []).filter(
        (location) => (relativeUnknown.availableLocationLevels.get(normalize(location)) ?? 0) === level
      );
      // A level that holds only a path card still needs its column.
      const hasPathCard = (pathsByLevel.get(level)?.length ?? 0) > 0;
      // Shards ticked in the column arrive through unplacedItems - they are
      // acquired items with no location like any other - so they are not asked
      // about separately here.
      const hasUnknownSphereCards = level === 0 && (unplacedItems.length || knowledge.areaHints.length);
      if (!placements.length && !availableLocations.length && !hasPathCard && !hasUnknownSphereCards) continue;

      columns.push({
        level,
        heading: level === 0 ? "Sphere ?" : level === 1 ? "After sphere ?" : `${level} steps after ?`,
        placements,
        groups: groupLocationsByArea(availableLocations.filter((location) => !isLocationMarked(location)))
      });
    }

    return columns;
  });

  // Click-and-drag panning, ported from the original's
  // installSphereBoardPanning (dev/app/app.js:2444) - the board scrolls in
  // both axes and is usually larger than its panel.
  //
  // Panning only engages past a small threshold, and a drag that panned
  // swallows the click that follows it, so dragging across the board can't
  // accidentally arm a location for item assignment.
  const PAN_THRESHOLD = 4;
  let boardElement: HTMLElement | undefined = $state();

  // Every area panel on the board, so one button can expand or collapse the lot.
  const areaGroupNodeIds = $derived([
    ...sphereColumns.flatMap((column) => column.groups.map((group) => `sphere-${column.sphereNumber}-area-${normalize(group.area)}`)),
    ...predictionColumns.flatMap((column) => column.groups.map((group) => `sphere-p${column.level}-area-${normalize(group.area)}`))
  ]);
  const groupsWillExpand = $derived(shouldExpandSphereGroups(areaGroupNodeIds));

  // The Locations toggle hides the area groups rather than leaving them out.
  // Which cards are purple, and which could still join a path, is read off
  // every card on the board, hidden ones included - an area group left out of
  // the DOM made a branch that only leads to unchecked locations look finished
  // to the Paths filter, the way a card left out once stayed hidden for good.
  // Rendered every time and hidden in place, the groups a new find opens up
  // are hidden as they arrive. A column with nothing else in it goes too.
  const showLocations = $derived(settings.showSphereLocations);
  const sphereColumnHasCards = (column: SphereColumnData) =>
    column.placements.length > 0 || (pathsBySphere.get(column.sphereNumber)?.length ?? 0) > 0;
  const predictionColumnHasCards = (column: PredictionColumnData) =>
    column.placements.length > 0 ||
    (pathsByLevel.get(column.level)?.length ?? 0) > 0 ||
    (column.level === 0 && (unplacedItems.length > 0 || knowledge.areaHints.length > 0));

  function startPan(event: PointerEvent) {
    if (event.button !== 0 || !boardElement) return;
    const board = boardElement;
    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollLeft = board.scrollLeft;
    const startScrollTop = board.scrollTop;
    let panning = false;

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!panning && Math.abs(deltaX) < PAN_THRESHOLD && Math.abs(deltaY) < PAN_THRESHOLD) return;
      if (!panning) {
        panning = true;
        board.classList.add("sphere-panning");
      }
      board.scrollLeft = startScrollLeft - deltaX;
      board.scrollTop = startScrollTop - deltaY;
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      if (!panning) return;
      board.classList.remove("sphere-panning");
      board.addEventListener("click", (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); }, { capture: true, once: true });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }
</script>

<section class="sphere-board" aria-label="Sphere progression graph" bind:this={boardElement} onpointerdown={startPan}>
  {#if !settings.sphereCalculation}
    <!-- Says where the switch is, since the board is otherwise indistinguishable
         from one that has nothing to show yet. -->
    <div class="sphere-board-empty">
      Sphere calculation is turned off. Enable it in the main tracker settings &#x2699;&#xfe0f;.
    </div>
  {:else if !calculation}
    <div class="sphere-board-empty">
      {sphereAnalysisCache.pending ? "Analyzing sphere logic..." : !data.sphereLogicLoaded ? "Sphere logic not loaded yet." : "No placements yet - assign an item to an exact location in Sphere mode."}
    </div>
  {:else}
    <div class="sphere-canvas">
      <!-- Scaled from the title-bar/header slider (SphereZoomSlider.svelte)
           rather than from section resizing: the board has no fixed design
           width, so it fills its container and scrolls instead. -->
      <!-- Inside the zoomed container so the lines scale with the cards, and
           absolutely positioned so they scroll with them. Hover is delegated
           here rather than bound per card - every card type would otherwise
           need its own listeners. -->
      <div
        class="sphere-columns"
        style="zoom: {settings.sphereBoardZoom / 100}"
        bind:this={columnsElement}
        onmouseover={(event) => setChainFocus(event.target as HTMLElement)}
        onmouseout={() => applySphereChainFocus(columnsElement ?? null, edgesElement ?? null, "")}
      >
        <svg class="sphere-edges" bind:this={edgesElement} aria-hidden="true"></svg>
        {#if filteredPlacements.length}
          <!-- See filteredPlacements: in the graph, not on screen. -->
          <div class="sphere-filtered-cards" hidden>
            {#each filteredPlacements as { placement, sphereNumber } (placement.id)}
              <SpherePlacementNode {placement} {sphereNumber} {calculation} relativeUnknown={sphereAnalysisCache.relativeUnknown} />
            {/each}
          </div>
        {/if}
        <article class="sphere-column start-column">
          <h3>Start</h3>
          <button
            type="button"
            class="sphere-groups-toggle"
            hidden={!showLocations}
            title={groupsWillExpand ? "Expand every area panel" : "Collapse every area panel"}
            onclick={() => toggleAllSphereGroups(areaGroupNodeIds)}
          >
            {groupsWillExpand ? "Expand all" : "Collapse all"}
          </button>
          <div class="sphere-start-node" data-node-id="start" title={data.sphereStartingGear.join("\n") || "No additional starting gear"}>
            {data.sphereStartingGear.length ? `${data.sphereStartingGear.length} starting items` : "Starting gear"}
          </div>
        </article>

        {#each sphereColumns as column (column.sphereNumber)}
          <article class="sphere-column" hidden={!showLocations && !sphereColumnHasCards(column)}>
            <h3>Sphere {column.sphereNumber}</h3>
            {#if column.groups.length}
              <div class="sphere-available-heading" hidden={!showLocations}>Available {column.groups.reduce((sum, g) => sum + g.locations.length, 0)}</div>
              <div class="sphere-area-groups" hidden={!showLocations}>
                {#each column.groups as group (group.area)}
                  <SphereAreaGroup area={group.area} locations={group.locations} bossIconsByLocation={pathBossIconsByLocation} sphere={column.sphereNumber} dependencySource={calculation.dependencies} />
                {/each}
              </div>
            {/if}
            {#if column.placements.length}
              <div class="sphere-placement-list">
                {#each column.placements as { placement } (placement?.id)}
                  {#if placement}
                    <SpherePlacementNode {placement} sphereNumber={column.sphereNumber} {calculation} relativeUnknown={sphereAnalysisCache.relativeUnknown} />
                  {/if}
                {/each}
              </div>
            {/if}
            {#if pathsBySphere.get(column.sphereNumber)?.length}
              <div class="sphere-prediction-list">
                {#each pathsBySphere.get(column.sphereNumber) ?? [] as entry (entry.hint.lineNumber)}
                  <SpherePathPredictionNode {entry} sourceIds={pathSourceIds.get(entry.hint.lineNumber) ?? []} />
                {/each}
              </div>
            {/if}
          </article>
        {/each}

        {#each predictionColumns as column (column.level)}
          <article class="sphere-column sphere-prediction-column" hidden={!showLocations && !predictionColumnHasCards(column)}>
            <h3>{column.heading}</h3>
            {#if column.groups.length}
              <div class="sphere-available-heading" hidden={!showLocations}>Available {column.groups.reduce((sum, g) => sum + g.locations.length, 0)}</div>
              <div class="sphere-area-groups" hidden={!showLocations}>
                {#each column.groups as group (group.area)}
                  <SphereAreaGroup area={group.area} locations={group.locations} bossIconsByLocation={pathBossIconsByLocation} sphere={`p${column.level}`} dependencySource={relativeAvailableDependencies} />
                {/each}
              </div>
            {/if}
            <!-- Path cards are rendered inside this block, so they have to
                 count towards showing it: a column whose only content was a
                 solved path card (Molgera in "After sphere ?", say) rendered
                 its heading with an empty body and the card disappeared. -->
            {#if predictionColumnHasCards(column)}
              <div class="sphere-prediction-list">
                {#each column.placements as placement (placement.id)}
                  <SpherePlacementNode
                    {placement}
                    sphereNumber={null}
                    {calculation}
                    relativeUnknown={sphereAnalysisCache.relativeUnknown}
                  />
                {/each}
                {#if column.level === 0}
                  {#each unplacedItems as entry (entry.id)}
                    <SphereUnplacedItemNode {entry} />
                  {/each}
                  {#each knowledge.areaHints as hint (hint.lineNumber)}
                    <SphereAreaHintNode {hint} {calculation} {occupiedLocationKeys} />
                  {/each}
                {/if}
                {#each pathsByLevel.get(column.level) ?? [] as entry (entry.hint.lineNumber)}
                  <SpherePathPredictionNode {entry} sourceIds={pathSourceIds.get(entry.hint.lineNumber) ?? []} />
                {/each}
              </div>
            {/if}
          </article>
        {/each}

        {#if unresolvedPaths.length}
          <article class="sphere-column sphere-path-column">
            <h3>Paths</h3>
            <div class="sphere-prediction-list">
              {#each unresolvedPaths as entry (entry.hint.lineNumber)}
                <SpherePathPredictionNode {entry} sourceIds={pathSourceIds.get(entry.hint.lineNumber) ?? []} />
              {/each}
            </div>
          </article>
        {/if}
      </div>
    </div>
  {/if}
</section>
