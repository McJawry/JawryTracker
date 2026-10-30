<script lang="ts">
  // The Race Tracking tab: links this tracker into a race shown on one stream,
  // as its host, as one runner's tracker operator, or as an admin helping run
  // it - who sees and corrects the combined run as the host does. All of Race Tracking is
  // reached from here - a tracker that never races shows none of it. The
  // connection itself runs in the main window (tauri/race-link.svelte.ts);
  // this tab only sets the session up and shows how it is going.
  //
  // The host's seed settings are the race's, so a host needs some to share,
  // and a runner's or admin's tracker takes them before it joins.
  import { DEFAULT_RACE_RELAY, RACE_DISPLAY_ORIGIN } from "$lib/constants";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { data } from "$lib/state/data.svelte";
  import { race, setRaceSession, formatAdminCode, formatRunnerCode, parseRaceCode } from "$lib/state/race.svelte";
  import { clearRun } from "$lib/state/new-run";
  import { loadReferenceData } from "$lib/logic/data-loading";
  import {
    getRaceGridSize,
    planRaceStreamGrid,
    RACE_GRID_MAX_COLUMNS,
    RACE_GRID_MAX_ROWS,
    RACE_GRID_WIDTH
  } from "$lib/logic/race-stream-grid";
  import { checkRelayRoom, relayBase } from "$lib/tauri/relay-socket";
  import { applySeedConfigText } from "$lib/tauri/rando-sync";
  import { confirmAction } from "$lib/tauri/confirm-dialog";

  const MAX_RUNNERS = 4;

  let runnerCount = $state(2);
  let raceCode = $state("");
  let busy = $state(false);
  let message = $state("");
  let copied = $state("");

  const session = $derived(race.session);
  const status = $derived(race.status);
  const runnerSlots = $derived(
    session && session.role !== "runner" ? Array.from({ length: session.slot }, (_, index) => index + 1) : []
  );
  const adminCode = $derived(session?.role === "host" && status.adminKey ? formatAdminCode(session.room, status.adminKey) : "");

  // What the browser sources' grid holds for this seed, so the host can size
  // it to fit - and how big the Browser Sources have to be to show it.
  const gridPlan = $derived(planRaceStreamGrid(settings.randoConfigText ?? "", settings.raceGridColumns, settings.raceGridRows));
  const gridSize = $derived(getRaceGridSize(gridPlan.columns, gridPlan.rows));
  const gridSummary = $derived.by(() => {
    if (gridPlan.leftOut.length) return `Too small for this seed. Left out: ${gridPlan.leftOut.join(", ")}.`;
    const filled = gridPlan.cells.filter((cell) => cell.kind !== "blank").length;
    return filled === gridPlan.cells.length ? "This seed fills every cell." : `This seed fills ${filled} of the ${gridPlan.cells.length} cells.`;
  });

  function saveGridSize() {
    settings.raceGridColumns = gridPlan.columns;
    settings.raceGridRows = gridPlan.rows;
    saveSettings();
  }

  async function hostRace() {
    if (!settings.randoConfigText?.trim()) {
      message =
        "This tracker has no seed settings to share yet. Sync them from the ⚙️ menu in the Main Tracker, " +
        "or load the seed's spoiler log, then create the room.";
      return;
    }
    const question =
      "Hosting replaces this tracker's run with the runners' combined runs as they come in. " +
      "Save it under Load saves first if you want to keep it.\n\nCreate a race room?";
    if (!(await confirmAction(question))) return;
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
    const code = parseRaceCode(raceCode);
    if (!code) {
      message = "That isn't a race code. A runner's looks like 79RVYS-1-ABCDEFGHJKLM, and an admin's like 79RVYS-A-ABCDEFGHJKLM.";
      return;
    }
    const slot = code.slot;
    busy = true;
    message = "Checking the code...";
    const check = await checkRelayRoom({
      relay: settings.raceRelayUrl,
      room: code.room,
      role: slot === null ? "admin" : "runner",
      slot: slot ?? undefined,
      key: code.key
    });
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
      slot === null
        ? "this tracker shows the runners' combined run in place of the run it has now, until you leave the race. " +
          "Save that under Load saves first if you want to keep it."
        : `everything in this tracker is sent to the host as runner ${slot}'s run until you leave the race. ` +
          "Start a new tracker first if it still holds another seed.";
    const question = differs
      ? `This tracker's seed settings don't match the host's. Joining syncs them to the host's, and then ${sent}\n\nSync and join the race?`
      : `This tracker's seed settings match the host's. From now on, ${sent}\n\nJoin the race?`;
    if (!(await confirmAction(question))) {
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
    if (slot === null) {
      clearRun();
      setRaceSession({ role: "admin", relay: settings.raceRelayUrl, room: code.room, key: code.key, slot: check.slots });
    } else {
      setRaceSession({ role: "runner", relay: settings.raceRelayUrl, room: code.room, key: code.key, slot });
    }
    raceCode = "";
    message = "";
  }

  async function leaveRace() {
    const question =
      session?.role === "host"
        ? "End the race? This tracker keeps the combined run, and the stream displays go blank."
        : session?.role === "admin"
          ? "Leave the race? This tracker keeps the combined run."
          : "Leave the race? This tracker stops sending to the host.";
    if (await confirmAction(question)) setRaceSession(null);
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
      tracker combines their runs into one for the Sphere Tracker, and shows each runner's items to OBS. Anyone helping run
      the race can join with the admin code to see and correct the combined run as well.
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
    <legend>Join a race</legend>
    <div class="setting-row">
      <input
        class="preset-name race-code"
        type="text"
        placeholder="Runner or admin code from the host"
        spellcheck="false"
        bind:value={raceCode}
        disabled={busy}
        onkeydown={(event) => event.key === "Enter" && joinRace()}
      />
      <button class="tool-button" type="button" disabled={busy || !raceCode.trim()} onclick={joinRace}>Join</button>
    </div>
    <p class="setting-hint">
      A runner code sends this tracker's run to the host as that runner's. An admin code shows the runners' combined run
      instead, which you can correct along with the host.
    </p>
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
      {session.role === "host" ? "Hosting room" : session.role === "admin" ? "Admin in room" : `Runner ${session.slot} in room`}
      <span class="race-code">{session.room}</span>
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
      <div class="race-runner">
        <p class="race-runner-name">Admins</p>
        {#if adminCode}
          <div class="setting-row">
            <input class="preset-name race-code" type="text" readonly value={adminCode} title="Admin code" onfocus={(event) => event.currentTarget.select()} />
            <button class="tool-button" type="button" onclick={() => copy(adminCode)}>{copied === adminCode ? "Copied" : "Copy code"}</button>
          </div>
        {:else if status.connected}
          <p class="setting-status">This race's relay is too old for admin codes.</p>
        {/if}
      </div>
      <p class="setting-hint">
        Send each runner's tracker operator their code. Add each address to OBS as a Browser Source - it shows that runner's
        items, and keeps working from one race to the next. The admin code is for anyone helping run the race, like a
        commentator: their tracker gets the same Merged and runner views as yours, and a correction either of you makes
        shows for both.
      </p>
      {#if status.display}<p class="setting-status">{status.display}</p>{/if}
    {:else if session.role === "admin"}
      {#each runnerSlots as slot (slot)}
        {@const runner = status.runners[slot]}
        <p class="race-runner-name">
          <span class="race-presence" class:online={runner?.online} aria-hidden="true"></span>
          Runner {slot}
          <span class="race-runner-detail">{runner?.online ? "online" : "offline"}, {updatedAt(runner?.updatedAt ?? 0)}</span>
        </p>
      {/each}
      <p class="setting-hint">
        This tracker shows the runners' combined run, and each runner's from the buttons above the map. Corrections you make
        to the combined run show for the host and other admins too, never for the runners. It keeps the host's seed settings
        until you leave the race.
      </p>
    {:else}
      <p class="setting-hint">
        This tracker's run is sent to the host as you track. It keeps the host's seed settings until you leave the race.
      </p>
    {/if}
    {#if session.role !== "runner" && status.conflicts.length}
      <p class="setting-status">The runners' trackers disagree:</p>
      <ul class="race-conflicts">
        {#each status.conflicts as conflict (conflict)}<li>{conflict}</li>{/each}
      </ul>
    {/if}

    <div class="setting-row">
      <button class="tool-button" type="button" onclick={leaveRace}>{session.role === "host" ? "End race" : "Leave race"}</button>
    </div>
  </fieldset>

  {#if session.role === "host"}
    <fieldset class="settings-group">
      <legend>Browser sources</legend>
      <label class="setting-toggle">
        <input type="checkbox" bind:checked={settings.raceStreamGrid} onchange={saveSettings} />
        <span>Grid layout</span>
      </label>
      <p class="setting-hint">
        Shows each runner's items as a grid of square cells, always {RACE_GRID_WIDTH} pixels wide, instead of the
        tracker's item grid on a transparent background. The items are the ones this seed's settings leave to find. Bosses the race doesn't need
        are crossed out once the runners' hints or chart marks show which ones they are, and a runner's beaten bosses get
        a check.
      </p>
      {#if settings.raceStreamGrid}
        <div class="setting-row race-grid-size">
          <label class="setting-control">
            <span>Columns</span>
            <input type="number" min="1" max={RACE_GRID_MAX_COLUMNS} bind:value={settings.raceGridColumns} onchange={saveGridSize} />
          </label>
          <label class="setting-control">
            <span>Rows</span>
            <input type="number" min="1" max={RACE_GRID_MAX_ROWS} bind:value={settings.raceGridRows} onchange={saveGridSize} />
          </label>
        </div>
        <p class="setting-status">{gridSummary}</p>
        <p class="setting-status">Set each Browser Source in OBS to {RACE_GRID_WIDTH} × {gridSize.height}.</p>
      {/if}
      <label class="setting-toggle">
        <input type="checkbox" bind:checked={settings.raceStreamGenericShards} onchange={saveSettings} />
        <span>Generic Triforce shards</span>
      </label>
      <p class="setting-hint">
        Every runner's Triforce shows how many shards they have, even when their tracker shows which ones. Turned off,
        each shows them the way that runner's tracker does.
      </p>
    </fieldset>
  {/if}
{/if}

{#if message}<p class="setting-status">{message}</p>{/if}
