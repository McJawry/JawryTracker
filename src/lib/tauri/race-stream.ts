// The stream display's own end of a race: follows one runner on the relay as
// a viewer and shows their run, loaded into this page's state.
//
// This page runs in OBS, not in the tracker, so it has nothing of the run to
// start from. Which race to follow comes from the host's tracker, which
// serves it at /race.json (src-tauri/src/race_display.rs) for as long as it
// hosts one - the page keeps asking, so a new race is picked up without
// touching OBS. The host's tracker also says there how to show it - as the
// grid layout or not, counting the shards or not - and which bosses the race
// is known to ask for, so a change there reaches OBS within a few seconds too.
// And the race's seed config, for a runner whose tracker never sent its own,
// and how long to hold the runner's updates back for, as far as their stream
// lags behind (race-delay.ts). `?room=` (and `?relay=`) in the address follow
// a room directly instead, shown the tracker's way and without a delay.
//
// Nothing here is ever saved. Every source on a stream shares one browser
// profile, so a display that wrote its runner's run to storage would hand it
// to every other display there.
import { RACE_DISPLAY_ORIGIN } from "$lib/constants";
import { toSphereState, type RaceStore } from "$lib/logic/race-merge";
import type { RaceGridCell } from "$lib/logic/race-stream-grid";
import type { BossRequirement } from "$lib/logic/dead-locations";
import { refreshSphereStartingGear } from "$lib/logic/sphere-logic-loading";
import { checked } from "$lib/state/checked.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { hintNotes, updateHintsFromNotes } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { settings } from "$lib/state/settings.svelte";
import { restoreRandoSync } from "./rando-sync";
import { openRelayConnection, type RelayConnection } from "./relay-socket";
import { createRaceDelay } from "./race-delay";

const RACE_POLL_MS = 3000;

interface DisplayedRace {
  relay: string;
  room: string;
}

/** How the host wants the runner shown: as a grid, with what is known of the bosses. */
export interface RaceDisplayLayout {
  grid: { columns: number; rows: number; cells: RaceGridCell[] };
  bosses: Record<string, BossRequirement>;
}

interface HostedRace extends DisplayedRace {
  grid?: RaceDisplayLayout["grid"];
  bosses?: RaceDisplayLayout["bosses"];
  /** Count every runner's Triforce shards, whichever way their tracker shows them. */
  genericShards?: boolean;
  /**
   * The race's seed config - the host's. A runner only ever tracked for by the
   * host or an admin, while their own tracker was offline, never sent one.
   */
  config?: string;
  /** Seconds, by slot: how long to hold each runner's updates back. */
  delays?: Record<string, number>;
}

function replaceContents<T>(target: Record<string, T>, next: Record<string, T>) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, next);
}

function parseRecord<T>(value: string): Record<string, T> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

let configQueue = Promise.resolve();

// The runner's own seed config, and the race's for when they've sent none.
let runnerConfig = "";
let raceConfig = "";

/** Starting gear lights items on the grid, so the seed's config counts. */
function applyConfig() {
  const value = runnerConfig.trim() ? runnerConfig : raceConfig;
  configQueue = configQueue.then(async () => {
    if (value === settings.randoConfigText) return;
    settings.randoConfigText = value;
    await restoreRandoSync();
  });
}

// The runner's own way of showing the shards, and whether the host overrides it.
let runnerGenericShards = false;
let hostGenericShards = false;

function showGenericShards() {
  settings.genericTriforceShards = hostGenericShards || runnerGenericShards;
}

/** One store of the runner's run, into this page's state - never into storage. */
function applyStore(store: RaceStore, value: string) {
  switch (store) {
    case "notes":
      hintNotes.value = value;
      updateHintsFromNotes({ save: false });
      break;
    case "checked":
      replaceContents(checked, parseRecord<boolean>(value));
      break;
    case "items":
      replaceContents(itemTrackerState, parseRecord<number>(value));
      break;
    case "dungeonItems":
      replaceContents(dungeonItemsState, parseRecord(value));
      break;
    case "sphere":
      Object.assign(sphere, toSphereState(parseRecord(value)));
      refreshSphereStartingGear();
      break;
    case "config":
      runnerConfig = value;
      applyConfig();
      break;
    case "display":
      runnerGenericShards = Boolean(parseRecord(value).genericTriforceShards);
      showGenericShards();
      break;
  }
}

// Each store as an empty run has it. The config comes first, as it does when
// the tracker loads: the starting gear it grants is a floor under the items.
const EMPTY_STORES: Record<RaceStore, string> = {
  config: "",
  notes: "",
  checked: "{}",
  items: "{}",
  dungeonItems: "{}",
  sphere: "{}",
  display: "{}"
};
const STORES = Object.keys(EMPTY_STORES) as RaceStore[];

/** A runner's whole run, with what they haven't sent shown empty. */
function applyRun(stores: Record<string, string>) {
  STORES.forEach((store) => applyStore(store, typeof stores[store] === "string" ? stores[store] : EMPTY_STORES[store]));
}

async function readHostedRace(): Promise<HostedRace | null> {
  try {
    const response = await fetch(`${RACE_DISPLAY_ORIGIN}/race.json`, { cache: "no-store" });
    const race = JSON.parse((await response.text()) || "null");
    return race?.relay && race.room ? race : null;
  } catch {
    return null;
  }
}

/**
 * Shows runner `slot` of whatever race is on, for as long as the page is open.
 * `onLayout` hears how the host wants it shown whenever that changes - null
 * for the tracker's own layout.
 */
export function followRaceDisplay(slot: number, onLayout: (layout: RaceDisplayLayout | null) => void): () => void {
  const params = new URL(window.location.href).searchParams;
  const pinned = params.get("room") ? { room: params.get("room")!.toUpperCase(), relay: params.get("relay") || settings.raceRelayUrl } : null;

  let connection: RelayConnection | null = null;
  let following = "";
  let stopped = false;

  // The runner's updates, held back by the delay the host set for them: one
  // store, or the whole run from the room's snapshot.
  let delaySeconds = 0;
  let online = false;
  const held = createRaceDelay<{ store: RaceStore; value: string } | { stores: Record<string, string> }>({
    delayOf: () => delaySeconds * 1000,
    apply: (_, update) => ("stores" in update ? applyRun(update.stores) : applyStore(update.store, update.value))
  });

  function follow(race: DisplayedRace | null) {
    const signature = race ? `${race.relay}|${race.room}` : "";
    if (signature === following) return;
    following = signature;
    connection?.close();
    connection = null;
    held.clear();
    online = false;
    applyRun({});
    if (!race) return;

    connection = openRelayConnection(
      { relay: race.relay, room: race.room, role: "viewer" },
      {
        onMessage: (message) => {
          if (message.type === "snapshot") {
            // The run as of the runner's last update, due once the delay has passed since then.
            online = message.online.includes(slot);
            const now = Date.now();
            held.push(slot, { stores: message.slots[String(slot)] ?? {} }, { at: Math.min(now, message.updated?.[slot] ?? now) });
          } else if (message.type === "presence" && message.slot === slot) {
            online = message.online;
          } else if (message.type === "state" && message.slot === slot && STORES.includes(message.store as RaceStore)) {
            // With the runner's own tracker offline, it's someone tracking for
            // them - who goes by their stream, so is behind already.
            held.push(slot, { store: message.store as RaceStore, value: message.value }, { delayed: online });
          }
        }
      }
    );
  }

  let layout = "null";
  function show(next: RaceDisplayLayout | null) {
    const signature = JSON.stringify(next);
    if (signature === layout) return;
    layout = signature;
    onLayout(next);
  }

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    const race = await readHostedRace();
    if (stopped) return;
    delaySeconds = Math.max(0, Number(race?.delays?.[slot]) || 0);
    follow(race);
    hostGenericShards = Boolean(race?.genericShards);
    showGenericShards();
    if ((race?.config ?? "") !== raceConfig) {
      raceConfig = race?.config ?? "";
      applyConfig();
    }
    show(race?.grid?.cells ? { grid: race.grid, bosses: race.bosses ?? {} } : null);
    pollTimer = setTimeout(poll, RACE_POLL_MS);
  }

  if (pinned) follow(pinned);
  else void poll();

  return () => {
    stopped = true;
    clearTimeout(pollTimer);
    held.clear();
    connection?.close();
  };
}
