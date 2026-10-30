<script lang="ts">
  // A race host's or admin's choice of whose run the tracker shows: the
  // runners' runs combined, which they can correct, or one runner's run as
  // their own tracker has it, to look at. Picked from any window - the main
  // window does the showing (tauri/race-link.svelte.ts).
  import { race, setRaceView } from "$lib/state/race.svelte";

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

  // A runner who has sent nothing has nothing to show.
  const hasRun = (slot: number) => (race.status.runners[slot]?.updatedAt ?? 0) > 0;
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
        disabled={!hasRun(slot)}
        title={hasRun(slot)
          ? `Runner ${slot}'s tracker as they have it. Only to look at: changes made here are undone.`
          : `Runner ${slot} hasn't sent anything yet`}
        onclick={() => setRaceView(slot)}
      >
        Runner {slot}
      </button>
    {/each}
  </div>
  {#if race.view}
    <span class="race-view-note">View only</span>
  {/if}
{/if}
