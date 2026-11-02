<script lang="ts">
  // After an hour without race activity - or on starting the tracker more than
  // an hour after the race's last - the tracker has disconnected from the room
  // (tauri/race-link.svelte.ts) and asks, over the whole main window, whether
  // to stay connected or leave the race. Left alone, a host's tracker went on
  // hosting from one day to the next, with only the view buttons above the
  // map to show for it.
  import { tick } from "svelte";
  import { race, requestRaceReconnect, setRaceSession } from "$lib/state/race.svelte";

  const session = $derived(race.session);
  const asking = $derived(Boolean(session && race.status.idle));

  const leaving = $derived(
    session?.role === "host"
      ? "Disconnect ends the race: this tracker keeps the combined run, and the stream displays go blank."
      : session?.role === "admin"
        ? "Disconnect leaves the race: this tracker keeps the combined run."
        : "Disconnect leaves the race: this tracker stops sending to the host."
  );
  const who = $derived(
    session?.role === "host" ? "hosting" : session?.role === "admin" ? "an admin in" : `runner ${session?.slot} in`
  );

  let stayButton: HTMLButtonElement | undefined = $state();

  // The answer most often wanted takes the keyboard.
  $effect(() => {
    if (asking) void tick().then(() => stayButton?.focus());
  });
</script>

{#if asking && session}
  <div class="race-idle-backdrop">
    <div class="race-idle-prompt" role="alertdialog" aria-modal="true" aria-labelledby="race-idle-title" aria-describedby="race-idle-text">
      <h2 id="race-idle-title">Still racing?</h2>
      <p id="race-idle-text">
        This tracker is {who} race room <span class="race-code">{session.room}</span>, which has had no activity for over an
        hour, so it disconnected.
      </p>
      <p>{leaving}</p>
      <div class="race-idle-actions">
        <button class="tool-button" type="button" onclick={() => setRaceSession(null)}>Disconnect</button>
        <button bind:this={stayButton} class="tool-button stay-connected" type="button" onclick={requestRaceReconnect}>
          Stay connected
        </button>
      </div>
    </div>
  </div>
{/if}
