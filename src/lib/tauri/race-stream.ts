// The stream display's own end of a race: follows one runner on the relay as
// a viewer and shows their run, loaded into this page's state.
//
// This page runs in OBS, not in the tracker, so it has nothing of the run to
// start from. Which race to follow comes from the host's tracker, which
// serves it at /race.json (src-tauri/src/race_display.rs) for as long as it
// hosts one - the page keeps asking, so a new race is picked up without
// touching OBS. `?room=` (and `?relay=`) in the address follow a room
// directly instead.
//
// Nothing here is ever saved. Every source on a stream shares one browser
// profile, so a display that wrote its runner's run to storage would hand it
// to every other display there.
import { RACE_DISPLAY_ORIGIN } from "$lib/constants";
import { toSphereState, type RaceStore } from "$lib/logic/race-merge";
import { refreshSphereStartingGear } from "$lib/logic/sphere-logic-loading";
import { checked } from "$lib/state/checked.svelte";
import { sphere } from "$lib/state/sphere.svelte";
import { hintNotes, updateHintsFromNotes } from "$lib/state/hints.svelte";
import { itemTrackerState } from "$lib/state/item-tracker.svelte";
import { dungeonItemsState } from "$lib/state/dungeon-items.svelte";
import { settings } from "$lib/state/settings.svelte";
import { restoreRandoSync } from "./rando-sync";
import { openRelayConnection, type RelayConnection } from "./relay-socket";

const RACE_POLL_MS = 3000;

interface DisplayedRace {
  relay: string;
  room: string;
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
      // Starting gear lights items on the grid, so the seed's config counts.
      configQueue = configQueue.then(async () => {
        if (value === settings.randoConfigText) return;
        settings.randoConfigText = value;
        await restoreRandoSync();
      });
      break;
    case "display":
      settings.genericTriforceShards = Boolean(parseRecord(value).genericTriforceShards);
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

async function readHostedRace(): Promise<DisplayedRace | null> {
  try {
    const response = await fetch(`${RACE_DISPLAY_ORIGIN}/race.json`, { cache: "no-store" });
    const race = JSON.parse((await response.text()) || "null");
    return race?.relay && race.room ? race : null;
  } catch {
    return null;
  }
}

/** Shows runner `slot` of whatever race is on, for as long as the page is open. */
export function followRaceDisplay(slot: number): () => void {
  const params = new URL(window.location.href).searchParams;
  const pinned = params.get("room") ? { room: params.get("room")!.toUpperCase(), relay: params.get("relay") || settings.raceRelayUrl } : null;

  let connection: RelayConnection | null = null;
  let following = "";
  let stopped = false;

  function follow(race: DisplayedRace | null) {
    const signature = race ? `${race.relay}|${race.room}` : "";
    if (signature === following) return;
    following = signature;
    connection?.close();
    connection = null;
    applyRun({});
    if (!race) return;

    connection = openRelayConnection(
      { relay: race.relay, room: race.room, role: "viewer" },
      {
        onMessage: (message) => {
          if (message.type === "snapshot") {
            applyRun(message.slots[String(slot)] ?? {});
          } else if (message.type === "state" && message.slot === slot && STORES.includes(message.store as RaceStore)) {
            applyStore(message.store as RaceStore, message.value);
          }
        }
      }
    );
  }

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    const race = await readHostedRace();
    if (stopped) return;
    follow(race);
    pollTimer = setTimeout(poll, RACE_POLL_MS);
  }

  if (pinned) follow(pinned);
  else void poll();

  return () => {
    stopped = true;
    clearTimeout(pollTimer);
    connection?.close();
  };
}
