<script lang="ts">
  // A race host's or admin's choice of whose run the tracker shows: the
  // runners' runs combined, which they can correct, or one runner's run as
  // their own tracker has it - to look at, or to track for them while their
  // tracker is offline, when the host allows it. Picked from any window - the
  // main window does the showing (tauri/race-link.svelte.ts).
  //
  // Then Conflicts, which flashes while the runners' trackers disagree on
  // something and opens the Race conflicts window to settle it.
  import { canTrackForRunner, isRaceViewReadOnly, race, runnerName, setRaceView } from "$lib/state/race.svelte";
  import { openPopoutWindow } from "$lib/tauri/popout-window";

  const slots = $derived(
    race.session && race.session.role !== "runner" ? Array.from({ length: race.session.slot }, (_, index) => index + 1) : []
  );

  const mergedTitle = $derived(
    [
      "Every runner's tracker combined. You can correct it here: your changes show for the host and admins, and in the bosses the stream shows, but never reach the runners - until a runner's tracker changes the same thing again.",
      race.status.edits ? `You have changed ${race.status.edits} thing${race.status.edits === 1 ? "" : "s"}.` : ""
    ]
      .filter(Boolean)
      .join(" ")
  );

  // A runner who has sent nothing has nothing to show - unless it's for this tracker to track.
  const hasRun = (slot: number) => (race.status.runners[slot]?.updatedAt ?? 0) > 0;

  const conflictCount = $derived(race.status.conflicts?.length ?? 0);

  function openConflicts() {
    void openPopoutWindow({
      label: "race-conflicts-popout",
      popoutParam: "race-conflicts",
      title: "Race conflicts",
      width: 460,
      height: 480,
      minWidth: 320,
      minHeight: 240
    });
  }

  function runnerTitle(slot: number): string {
    const name = runnerName(slot);
    if (canTrackForRunner(slot)) return `${name}'s tracker is offline, so you can track for them here. What you change goes to the race as their run.`;
    if (hasRun(slot)) return `${name}'s tracker as they have it. Only to look at: changes made here are undone.`;
    return `${name} hasn't sent anything yet`;
  }
</script>

{#if slots.length}
  <div class="race-view-switcher" role="group" aria-label="Whose tracker to show">
    <button
      type="button"
      class="tool-button map-toolbar-button"
      class:active={!race.view}
      aria-pressed={!race.view}
      title={mergedTitle}
      onclick={() => setRaceView(0)}
    >
      Merged
    </button>
    {#each slots as slot (slot)}
      <button
        type="button"
        class="tool-button map-toolbar-button"
        class:active={race.view === slot}
        aria-pressed={race.view === slot}
        disabled={!hasRun(slot) && !canTrackForRunner(slot)}
        title={runnerTitle(slot)}
        onclick={() => setRaceView(slot)}
      >
        {runnerName(slot)}
      </button>
    {/each}
    <button
      type="button"
      class="tool-button map-toolbar-button race-conflicts-button"
      class:flashing={conflictCount > 0}
      title={conflictCount
        ? `The runners' trackers disagree on ${conflictCount} thing${conflictCount === 1 ? "" : "s"}. Open the list to settle them.`
        : "The runners' trackers agree on everything they've recorded"}
      onclick={openConflicts}
    >
      Conflicts
    </button>
  </div>
  {#if race.view}
    <span class="race-view-note">{isRaceViewReadOnly() ? "View only" : `Tracking for ${runnerName(race.view)}`}</span>
  {/if}
{/if}
