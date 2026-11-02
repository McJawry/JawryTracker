<script lang="ts">
  // The Race conflicts window: what the runners' trackers disagree on
  // (logic/race-conflicts.ts), a line each. Clicking one asks how to settle
  // it, the way the item picker asks which copy you meant. The answer goes to
  // the main window, which makes it corrections to the merged view
  // (tauri/race-link.svelte.ts) - shared with the host and admins like any
  // other, and never sent to the runners. So it settles the merged view
  // whichever run the tracker is showing.
  import { describeRaceConflict, type RaceConflict, type RaceConflictPlacement } from "$lib/logic/race-conflicts";
  import { placementCorrection } from "$lib/logic/race-edits";
  import { itemImage } from "$lib/logic/images";
  import { race, requestRaceResolution } from "$lib/state/race.svelte";
  import { sphere } from "$lib/state/sphere.svelte";

  const conflicts = $derived(race.status.conflicts ?? []);
  const combining = $derived(race.session?.role === "host" || race.session?.role === "admin");

  /** The conflict whose question is showing. */
  let open = $state("");
  /** After Somewhere else: the item still to be placed where it really is. */
  let placing = $state("");

  // Placed in the merged view, it's where it really is now.
  $effect(() => {
    const item = placing.toLowerCase();
    if (item && !race.view && sphere.placements.some((placement) => placement.item.toLowerCase() === item)) placing = "";
  });

  const recordedBy = (runners: string[]) => (runners.length ? runners.join(", ") : "Added in the merged view");

  function settle(conflict: RaceConflict, sphere: Record<string, string | null>, signature?: string) {
    requestRaceResolution({ key: conflict.key, signature, sphere });
    open = "";
  }

  /** What's at a location: one of the items the runners' trackers have there, or neither. */
  function chooseItem(conflict: Extract<RaceConflict, { kind: "location" }>, item: string | null) {
    settle(conflict, Object.fromEntries([placementCorrection(conflict.location, item)]), conflict.signature);
  }

  function choosePlacement(conflict: Extract<RaceConflict, { kind: "copies" }>, chosen: RaceConflictPlacement) {
    if (conflict.copies === 1) {
      // The one that's right stays, and the others go.
      const others = conflict.placements.filter((placement) => placement !== chosen);
      settle(conflict, Object.fromEntries(others.map((placement) => placementCorrection(placement.location, null))));
    } else {
      // One fewer, and the question stays until few enough are left.
      requestRaceResolution({ key: conflict.key, sphere: Object.fromEntries([placementCorrection(chosen.location, null)]) });
    }
  }

  /** None of them is right: they all go, for the item to be placed where it is. */
  function placeElsewhere(conflict: Extract<RaceConflict, { kind: "copies" }>) {
    settle(conflict, Object.fromEntries(conflict.placements.map((placement) => placementCorrection(placement.location, null))));
    placing = conflict.item;
  }

  function chooseEntrance(conflict: Extract<RaceConflict, { kind: "entrance" }>, target: string) {
    settle(conflict, { [conflict.field]: target }, conflict.signature);
  }

  function toggle(conflict: RaceConflict) {
    placing = "";
    open = open === conflict.key ? "" : conflict.key;
  }
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && (open = "")} />

<main class="race-conflicts-window">
  {#if !combining}
    <p class="race-conflicts-empty">Conflicts are for a race's host and admins.</p>
  {:else if !conflicts.length}
    <p class="race-conflicts-empty">No conflicts. The runners' trackers agree on everything they've recorded.</p>
  {:else}
    <p class="race-conflicts-hint">Click a conflict to settle it in the merged view. The runners' trackers aren't changed.</p>
  {/if}
  {#if placing}
    <div class="race-conflicts-note">
      <p>
        Place the {placing} where it really is in the merged view: click its location on the map, then the {placing}.
      </p>
      <button type="button" class="tool-button" onclick={() => (placing = "")}>Cancel</button>
    </div>
  {/if}

  {#if combining}
    <ul class="race-conflict-list">
      {#each conflicts as conflict (conflict.key)}
        <li>
          {#if conflict.kind === "settings"}
            <p class="race-conflict-line race-conflict-info">
              {describeRaceConflict(conflict)}. Their tracker takes the race's by itself - if this stays, ask them to leave the
              race and join again.
            </p>
          {:else}
            <button
              type="button"
              class="tool-button race-conflict-line"
              class:open={open === conflict.key}
              aria-expanded={open === conflict.key}
              onclick={() => toggle(conflict)}
            >
              {describeRaceConflict(conflict)}
            </button>
          {/if}

          {#if open === conflict.key && conflict.kind === "location"}
            <div class="race-conflict-prompt">
              <p class="race-conflict-question">What's at {conflict.location}?</p>
              {#each conflict.choices as choice (choice.value)}
                <button type="button" class="race-conflict-card" onclick={() => chooseItem(conflict, choice.value)}>
                  <img src={itemImage(choice.value)} alt="" />
                  <span><strong>{choice.value}</strong><span class="race-conflict-by">{recordedBy(choice.runners)}</span></span>
                </button>
              {/each}
              <button type="button" class="race-conflict-card" onclick={() => chooseItem(conflict, null)}>
                <span class="race-conflict-blank" aria-hidden="true"></span>
                <span><strong>None of these</strong><span class="race-conflict-by">Leave nothing recorded there</span></span>
              </button>
              <button type="button" class="tool-button race-conflict-cancel" onclick={() => (open = "")}>Cancel</button>
            </div>
          {:else if open === conflict.key && conflict.kind === "copies"}
            <div class="race-conflict-prompt">
              <p class="race-conflict-question">
                {conflict.copies === 1
                  ? `Which ${conflict.item} is right?`
                  : `The seed has ${conflict.copies || "none"} to find. Remove which ${conflict.item}?`}
              </p>
              {#each conflict.placements as placement (placement.location)}
                <button type="button" class="race-conflict-card" onclick={() => choosePlacement(conflict, placement)}>
                  <img src={itemImage(placement.item)} alt="" />
                  <span><strong>{placement.location}</strong><span class="race-conflict-by">{recordedBy(placement.runners)}</span></span>
                </button>
              {/each}
              {#if conflict.copies === 1}
                <button type="button" class="race-conflict-card" onclick={() => placeElsewhere(conflict)}>
                  <span class="race-conflict-blank" aria-hidden="true"></span>
                  <span><strong>Somewhere else</strong><span class="race-conflict-by">Remove these and place it yourself</span></span>
                </button>
              {/if}
              <button type="button" class="tool-button race-conflict-cancel" onclick={() => (open = "")}>Cancel</button>
            </div>
          {:else if open === conflict.key && conflict.kind === "entrance"}
            <div class="race-conflict-prompt">
              <p class="race-conflict-question">Where does {conflict.name} lead?</p>
              {#each conflict.choices as choice (choice.value)}
                <button type="button" class="race-conflict-card" onclick={() => chooseEntrance(conflict, choice.value)}>
                  <span><strong>{choice.value}</strong><span class="race-conflict-by">{recordedBy(choice.runners)}</span></span>
                </button>
              {/each}
              <button type="button" class="tool-button race-conflict-cancel" onclick={() => (open = "")}>Cancel</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .race-conflicts-window {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 100%;
    padding: 12px;
    box-sizing: border-box;
    background: var(--panel);
    color: var(--ink);
  }

  .race-conflicts-empty,
  .race-conflicts-hint,
  .race-conflicts-note p {
    margin: 0;
    font-size: 0.82rem;
  }

  /* A step still to take, which Cancel or placing the item ends. */
  .race-conflicts-note {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--accent);
    border-radius: 6px;
  }

  .race-conflicts-note .tool-button,
  .race-conflict-cancel {
    flex: 0 0 auto;
    min-height: 28px;
    padding: 0 10px;
    font-size: 0.78rem;
    font-weight: 800;
  }

  .race-conflict-cancel {
    align-self: flex-start;
  }

  .race-conflict-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .race-conflict-line {
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 7px 10px;
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.35;
    text-align: left;
    white-space: normal;
  }

  .race-conflict-line.open {
    border-color: var(--accent);
  }

  /* Nothing to choose: read, not clicked. */
  .race-conflict-info {
    border: 1px dashed var(--line);
    border-radius: 6px;
    font-weight: 600;
  }

  .race-conflict-prompt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0 2px 12px;
  }

  .race-conflict-question {
    margin: 0 0 2px;
    font-size: 0.8rem;
    font-weight: 800;
  }

  .race-conflict-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    color: var(--ink);
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }

  .race-conflict-card:hover {
    border-color: var(--accent);
  }

  .race-conflict-card img,
  .race-conflict-blank {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  .race-conflict-card > span:last-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .race-conflict-by {
    font-size: 0.74rem;
  }
</style>
