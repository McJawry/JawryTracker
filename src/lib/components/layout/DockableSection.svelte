<script lang="ts">
  // Generic wrapper for every top-level dockable section: title bar (drag
  // handle + name + dock/undock + hide), resize handles, and content scaling
  // via CSS zoom so a section looks the same proportions regardless of its
  // pixel size or the monitor's resolution.
  //
  // Resize semantics: the right edge stretches horizontally (content width
  // only, no scaling) for sections flagged horizontallyResizable - Hint
  // Panel and Notes - and scales uniformly for everything else; the bottom,
  // left, and corner handles always scale uniformly. Sphere Board
  // (fillContent) fills its container and scales from its own title-bar
  // slider instead, since it has no fixed design width.
  //
  // Drag-and-drop reordering is constrained to the four edges of whatever
  // section it's dropped on (moveSectionToPosition,
  // $lib/state/layout.svelte.ts) - sections always stay snapped adjacent to
  // a neighbor, never freely positioned.
  import { DOCKABLE_SECTIONS } from "$lib/dockable-sections";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { moveSectionToPosition, type DropZone } from "$lib/state/layout.svelte";
  import { openPopoutForSection } from "$lib/tauri/popout-geometry";
  import { markUndocked, undockedState } from "$lib/state/undocked.svelte";
  import { startEdgeResize, startUniformResize } from "$lib/logic/resize-panel";
  import { getSectionContentStyle, getSectionLogicalWidth, getSectionScale } from "./section-scaling.svelte";
  import { SECTION_DRAG_MIME } from "./section-drag";
  import SphereZoomSlider from "./SphereZoomSlider.svelte";

  let { sectionId }: { sectionId: string } = $props();

  const def = $derived(DOCKABLE_SECTIONS[sectionId]);
  // A section that is popped out must not also render inline - otherwise
  // undocking leaves a duplicate copy behind in the docked layout. When its
  // window closes, popout-session marks it docked again and it reappears.
  const isUndocked = $derived(undockedState.ids.includes(sectionId));
  const isVisible = $derived(
    (!def.visibilityKey || settings.sectionVisibility[def.visibilityKey]) && !isUndocked
  );
  const contentStyle = $derived(getSectionContentStyle(sectionId));

  let sectionEl: HTMLDivElement | undefined = $state();
  let dragOverZone: DropZone | null = $state(null);

  // The title bar is the section's drag handle, but it also hosts the Sphere
  // Board's scale slider - and dragging a range input inside a
  // draggable="true" ancestor starts the ancestor's drag instead of moving
  // the thumb. Suspending draggable while the pointer is over the slider
  // keeps both usable.
  let titlebarDraggable = $state(true);

  function toggleHide() {
    if (!def.visibilityKey) return;
    settings.sectionVisibility[def.visibilityKey] = !settings.sectionVisibility[def.visibilityKey];
    saveSettings();
  }

  function undock() {
    markUndocked(sectionId);
    // Placed near the main window, or back at its remembered spot - Tauri
    // otherwise lets the OS choose, which often lands on another monitor.
    void openPopoutForSection(sectionId);
  }

  function handleDragStart(event: DragEvent) {
    event.dataTransfer?.setData(SECTION_DRAG_MIME, sectionId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function zoneFromPointer(event: DragEvent): DropZone {
    const rect = sectionEl!.getBoundingClientRect();
    const relX = (event.clientX - rect.left) / rect.width;
    const relY = (event.clientY - rect.top) / rect.height;
    if (relX < 0.25) return "left";
    if (relX > 0.75) return "right";
    return relY < 0.5 ? "top" : "bottom";
  }

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(SECTION_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dragOverZone = zoneFromPointer(event);
  }

  function handleDrop(event: DragEvent) {
    const draggedId = event.dataTransfer?.getData(SECTION_DRAG_MIME);
    const zone = dragOverZone;
    dragOverZone = null;
    if (!draggedId || !zone) return;
    event.preventDefault();
    moveSectionToPosition(draggedId, sectionId, zone);
  }

  function renderedSize() {
    const rect = sectionEl?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  function uniformResize(event: PointerEvent, axis: "width" | "height" | "both", invertX = false, invertY = false) {
    startUniformResize({
      event,
      axis,
      invertX,
      invertY,
      getRenderedSize: renderedSize,
      getCurrentScaledWidth: () => settings.sectionSizes[sectionId] ?? def.defaultWidth,
      // Low floor so the Hint Panel in particular can be shrunk right down.
      min: 80,
      max: 2000,
      resizingElement: sectionEl,
      onResize: (scaledWidth) => (settings.sectionSizes[sectionId] = scaledWidth),
      onCommit: saveSettings
    });
  }

  // Right edge on Hint Panel/Notes: stretch the logical content width
  // instead of scaling. The drag is in rendered px, so it's divided by the
  // current zoom to stay 1:1 with the pointer.
  function horizontalResize(event: PointerEvent) {
    const scale = getSectionScale(sectionId);
    startEdgeResize({
      event,
      axis: "width",
      getCurrentSize: () => getSectionLogicalWidth(sectionId) * scale,
      min: 200,
      max: 1600,
      resizingElement: sectionEl,
      onResize: (renderedWidth) => (settings.sectionWidths[sectionId] = Math.round(renderedWidth / scale)),
      onCommit: saveSettings
    });
  }

  function handleRightEdge(event: PointerEvent) {
    if (def.horizontallyResizable) horizontalResize(event);
    else uniformResize(event, "width");
  }
</script>

{#if isVisible}
  <div
    class="dockable-panel dockable-section section-{sectionId}"
    class:fill-content={def.fillContent}
    bind:this={sectionEl}
    ondragover={handleDragOver}
    ondragleave={() => (dragOverZone = null)}
    ondrop={handleDrop}
  >
    <div class="dockable-titlebar" draggable={titlebarDraggable} ondragstart={handleDragStart}>
      <span class="dockable-titlebar-name">{def.title}</span>
      {#if def.fillContent}
        <span
          class="dockable-titlebar-control"
          onpointerenter={() => (titlebarDraggable = false)}
          onpointerleave={() => (titlebarDraggable = true)}
        >
          <SphereZoomSlider />
        </span>
      {/if}
      <div class="dockable-titlebar-actions">
        <button type="button" class="dockable-titlebar-button" title="Pop out into its own window" onclick={undock}>&#x2b1a;</button>
        {#if def.canHide}
          <button type="button" class="dockable-titlebar-button" title="Hide this section" onclick={toggleHide}>&times;</button>
        {/if}
      </div>
    </div>

    <div class="dockable-section-content" style={contentStyle}>
      <def.component />
    </div>

    <div
      class="dockable-resize-handle right"
      class:horizontal={def.horizontallyResizable}
      aria-hidden="true"
      onpointerdown={handleRightEdge}
    ></div>
    <div class="dockable-resize-handle left" aria-hidden="true" onpointerdown={(event) => uniformResize(event, "width", true)}></div>
    <div class="dockable-resize-handle bottom" aria-hidden="true" onpointerdown={(event) => uniformResize(event, "height")}></div>
    <div class="dockable-resize-handle corner" aria-hidden="true" onpointerdown={(event) => uniformResize(event, "both")}></div>

    {#if dragOverZone}
      <div class="dockable-drop-zone {dragOverZone}" aria-hidden="true"></div>
    {/if}
  </div>
{/if}
