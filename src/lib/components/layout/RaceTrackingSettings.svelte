<script lang="ts">
  // The Race Tracking tab: links this tracker into a race shown on one stream,
  // as its host or as one runner's tracker operator. All of Race Tracking is
  // reached from here - a tracker that never races shows none of it. The
  // connection itself runs in the main window (tauri/race-link.svelte.ts);
  // this tab only sets the session up and shows how it is going.
  //
  // The host's seed settings are the race's, so a host needs some to share,
  // and a runner's tracker takes them before it joins.
  import { DEFAULT_RACE_RELAY, RACE_DISPLAY_ORIGIN } from "$lib/constants";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { data } from "$lib/state/data.svelte";
  import { race, setRaceSession, formatRunnerCode, parseRunnerCode } from "$lib/state/race.svelte";
  import { clearRun } from "$lib/state/new-run";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import { checkRelayRoom, relayBase } from "$lib/tauri/relay-socket";
  import { applySeedConfigText } from "$lib/tauri/rando-sync";

  const MAX_RUNNERS = 4;

  let runnerCount = $state(2);
  let runnerCode = $state("");
  let busy = $state(false);
  let message = $state("");
  let copied = $state("");

  const session = $derived(race.session);
  const status = $derived(race.status);
  const runnerSlots = $derived(session?.role === "host" ? Array.from({ length: session.slot }, (_, index) => index + 1) : []);

  async function hostRace() {
    if (!settings.randoConfigText?.trim()) {
      message =
        "This tracker has no seed settings to share yet. Sync them from the ⚙️ menu in the Main Tracker, " +
        "or load the seed's spoiler log, then create the room.";
      return;
    }
    if (
      !confirm(
        "Hosting replaces this tracker's run with the runners' combined runs as they come in. " +
          "Save it under Load saves first if you want to keep it.\n\nCreate a race room?"
      )
    )
      return;
    busy = true;
    message = "Creating a room...";
    try {
      const response = await fetch(`${relayBase(settings.raceRelayUrl)}/rooms?slots=${runnerCount}`, { method: "POST" });
      if (!response.ok) throw new Error(`the relay answered ${response.status}`);
      const { room, hostKey, slotKeys } = await response.json();
      clearRun();
      setRaceSession({ role: "host", relay: settings.raceRelayUrl, room, key: hostKey, slot: slotKeys.length, runnerKeys: slotKeys });
      message = "";
    } catch (error) {
      message = `Couldn't create a room: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
    }
  }

  async function joinRace() {
    const code = parseRunnerCode(runnerCode);
    if (!code) {
      message = "That isn't a runner code. They look like 79RVYS-1-ABCDEFGHJKLM.";
      return;
    }
    busy = true;
    message = "Checking the code...";
    const check = await checkRelayRoom({ relay: settings.raceRelayUrl, room: code.room, role: "runner", slot: code.slot, key: code.key });
    busy = false;
    if (!check.ok) {
      message = check.message;
      return;
    }
    const hostConfig = check.config ?? "";
    if (!hostConfig.trim()) {
      message = "The host's tracker hasn't shared its seed settings yet. Try again in a moment.";
      return;
    }

    // A tracker on other seed settings than the host's would work out a
    // different seed's logic, so joining syncs them first - or doesn't join.
    const differs = hostConfig.trim() !== (settings.randoConfigText ?? "").trim();
    const sent =
      `everything in this tracker is sent to the host as runner ${code.slot}'s run until you leave the race. ` +
      "Start a new tracker first if it still holds another seed.";
    const question = differs
      ? `This tracker's seed settings don't match the host's. Joining syncs them to the host's, and then ${sent}\n\nSync and join the race?`
      : `From now on, ${sent}\n\nJoin the race?`;
    if (!confirm(question)) {
      message = "";
      return;
    }

    if (differs) {
      busy = true;
      message = "Syncing the host's seed settings...";
      try {
        // The logic they're read into maps onto the location list, which
        // this window doesn't load on its own.
        if (!data.loaded) await loadReferenceData();
        await applySeedConfigText(hostConfig);
      } catch (error) {
        busy = false;
        message = `Couldn't sync the seed settings: ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
      busy = false;
    }
    setRaceSession({ role: "runner", relay: settings.raceRelayUrl, room: code.room, key: code.key, slot: code.slot });
    runnerCode = "";
    message = "";
  }

  function leaveRace() {
    const question =
      session?.role === "host"
        ? "End the race? This tracker keeps the combined run, and the stream displays go blank."
        : "Leave the race? This tracker stops sending to the host.";
    if (confirm(question)) setRaceSession(null);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = text;
      setTimeout(() => {
        if (copied === text) copied = "";
      }, 1500);
    } catch {
      message = "Couldn't copy - select the text and press Ctrl+C.";
    }
  }

  function updatedAt(time: number): string {
    return time ? `updated ${new Date(time).toLocaleTimeString()}` : "nothing sent yet";
  }
</script>

{#if !session}
  <fieldset class="settings-group">
    <legend>Race Tracking</legend>
    <p class="setting-hint">
      Links trackers for a race shown on one stream. Each runner's tracker operator joins with a runner code. The host's
      tracker combines their runs into one for the Sphere Tracker, and shows each runner's items to OBS.
    </p>
  </fieldset>

  <fieldset class="settings-group">
    <legend>Host a race</legend>
    <div class="setting-row">
      <label class="setting-control">
        <span>Runners</span>
        <select bind:value={runnerCount} disabled={busy}>
          {#each Array.from({ length: MAX_RUNNERS - 1 }, (_, index) => index + 2) as count (count)}
            <option value={count}>{count}</option>
          {/each}
        </select>
      </label>
      <button class="tool-button" type="button" disabled={busy} onclick={hostRace}>Create race room</button>
    </div>
    <p class="setting-hint">
      Replaces this tracker's run with the runners' combined runs. Runners take this tracker's seed settings, so sync them
      first.
    </p>
  </fieldset>

  <fieldset class="settings-group">
    <legend>Track for a runner</legend>
    <div class="setting-row">
      <input
        class="preset-name race-code"
        type="text"
        placeholder="Runner code from the host"
        spellcheck="false"
        bind:value={runnerCode}
        disabled={busy}
        onkeydown={(event) => event.key === "Enter" && joinRace()}
      />
      <button class="tool-button" type="button" disabled={busy || !runnerCode.trim()} onclick={joinRace}>Join</button>
    </div>
  </fieldset>

  <details class="race-relay">
    <summary>Relay server</summary>
    <div class="setting-row">
      <input class="preset-name" type="url" spellcheck="false" bind:value={settings.raceRelayUrl} onchange={saveSettings} />
      <button
        class="tool-button"
        type="button"
        disabled={settings.raceRelayUrl === DEFAULT_RACE_RELAY}
        onclick={() => {
          settings.raceRelayUrl = DEFAULT_RACE_RELAY;
          saveSettings();
        }}>Reset</button
      >
    </div>
    <p class="setting-hint">Everyone in a race has to use the same one.</p>
  </details>
{:else}
  <fieldset class="settings-group">
    <legend>Race Tracking</legend>
    <p class="race-room">
      {session.role === "host" ? "Hosting room" : `Runner ${session.slot} in room`} <span class="race-code">{session.room}</span>
    </p>
    <p class="setting-status race-runner-name">
      <span class="race-presence" class:online={status.connected} aria-hidden="true"></span>
      {status.message || "Connecting..."}
    </p>

    {#if session.role === "host"}
      {#each runnerSlots as slot (slot)}
        {@const runner = status.runners[slot]}
        {@const code = formatRunnerCode(session.room, slot, session.runnerKeys?.[slot - 1] ?? "")}
        {@const display = `${RACE_DISPLAY_ORIGIN}/?stream=${slot}`}
        <div class="race-runner">
          <p class="race-runner-name">
            <span class="race-presence" class:online={runner?.online} aria-hidden="true"></span>
            Runner {slot}
            <span class="race-runner-detail">{runner?.online ? "online" : "offline"}, {updatedAt(runner?.updatedAt ?? 0)}</span>
          </p>
          <div class="setting-row">
            <input class="preset-name race-code" type="text" readonly value={code} title="Runner code" onfocus={(event) => event.currentTarget.select()} />
            <button class="tool-button" type="button" onclick={() => copy(code)}>{copied === code ? "Copied" : "Copy code"}</button>
          </div>
          <div class="setting-row">
            <input class="preset-name race-code" type="text" readonly value={display} title="OBS Browser Source" onfocus={(event) => event.currentTarget.select()} />
            <button class="tool-button" type="button" onclick={() => copy(display)}>{copied === display ? "Copied" : "Copy"}</button>
          </div>
        </div>
      {/each}
      <p class="setting-hint">
        Send each runner's tracker operator their code. Add each address to OBS as a Browser Source - it shows that runner's
        items on a transparent background, and keeps working from one race to the next.
      </p>
      {#if status.display}<p class="setting-status">{status.display}</p>{/if}
      {#if status.conflicts.length}
        <p class="setting-status">The runners' trackers disagree:</p>
        <ul class="race-conflicts">
          {#each status.conflicts as conflict (conflict)}<li>{conflict}</li>{/each}
        </ul>
      {/if}
    {:else}
      <p class="setting-hint">
        This tracker's run is sent to the host as you track. It keeps the host's seed settings until you leave the race.
      </p>
    {/if}

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={leaveRace}>{session.role === "host" ? "End race" : "Leave race"}</button>
    </div>
  </fieldset>
{/if}

{#if message}<p class="setting-status">{message}</p>{/if}
