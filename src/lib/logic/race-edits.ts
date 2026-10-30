// A race host's corrections to the combined run (logic/race-merge.ts). When a
// runner's tracker has something wrong, the host can put it right in their
// own - for the stream, and for their Sphere Tracker - without it going back
// to anyone: the runners' trackers never hear of it.
//
// A correction is kept a field at a time - one item's stage, one location's
// check, one hint, one placement, one entrance - as the value to show in place
// of the combined run's, or null for none. It holds until a runner's tracker
// sends a new value for that same field: whoever changed it last is right.
import { toSphereState, type DescribeNoteLine, type RaceSlotStores } from "$lib/logic/race-merge";

/** What a host can correct: everything a runner sends but the config and display. */
export const EDITABLE_STORES = ["notes", "checked", "items", "sphere", "dungeonItems"] as const;
export type EditableStore = (typeof EDITABLE_STORES)[number];

/** A run as its stores are saved. */
export type RaceRunStores = Record<EditableStore, string>;

/** Store -> field -> the value shown instead, worded as storeFields words it, or null for none. */
export type RaceEdits = Partial<Record<EditableStore, Record<string, string | null>>>;

/** A store's fields, each worded so that two values compare as text. */
type Fields = Map<string, string>;

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

function parseRecord<T>(text: string | undefined): Record<string, T> {
  const value = parseJson(text);
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, T>) } : {};
}

const locationKey = (location: string) => location.trim().toLowerCase();

interface StoreFields {
  /** Every field the store holds that isn't at its default. */
  read(text: string, describe: DescribeNoteLine): Fields;
  /** The store with these fields set: to a value, or to the default for null. */
  write(text: string, edits: Record<string, string | null>, describe: DescribeNoteLine): string;
}

/**
 * The notes a hint at a time. Lines that mean the same hint are one field, so
 * a hint written differently is the same hint changed; the seed can give one
 * hint twice, so the field holds every line that says it.
 */
const NOTES: StoreFields = {
  read(text, describe) {
    const lines = new Map<string, string[]>();
    text.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const { key } = describe(line);
      lines.set(key, [...(lines.get(key) ?? []), line.trimEnd()]);
    });
    return new Map([...lines].map(([key, texts]) => [key, JSON.stringify(texts)]));
  },
  // A corrected hint takes the place of the first line it was written on, and
  // a new one goes at the end.
  write(text, edits, describe) {
    const out: string[] = [];
    const placed = new Set<string>();
    text.split(/\r?\n/).forEach((line) => {
      const key = line.trim() ? describe(line).key : "";
      if (!key || !(key in edits)) {
        out.push(line);
        return;
      }
      if (placed.has(key)) return;
      placed.add(key);
      const value = edits[key];
      if (value !== null) out.push(...(parseJson(value) as string[]));
    });
    Object.entries(edits).forEach(([key, value]) => {
      if (!placed.has(key) && value !== null) out.push(...(parseJson(value) as string[]));
    });
    return out.join("\n");
  }
};

const CHECKED: StoreFields = {
  read(text) {
    return new Map(
      Object.entries(parseRecord<unknown>(text))
        .filter(([, value]) => value)
        .map(([key]) => [key, "true"])
    );
  },
  write(text, edits) {
    const record = parseRecord<boolean>(text);
    Object.entries(edits).forEach(([key, value]) => {
      if (value === null) delete record[key];
      else record[key] = true;
    });
    return JSON.stringify(record);
  }
};

const ITEMS: StoreFields = {
  read(text) {
    return new Map(
      Object.entries(parseRecord<unknown>(text))
        .filter(([, stage]) => typeof stage === "number" && stage !== 0)
        .map(([item, stage]) => [item, String(stage)])
    );
  },
  write(text, edits) {
    const record = parseRecord<number>(text);
    Object.entries(edits).forEach(([item, stage]) => {
      if (stage === null) delete record[item];
      else record[item] = Number(stage);
    });
    return JSON.stringify(record);
  }
};

/** A dungeon's keys, map and compass, one field each: "Tower of the Gods|smallKeys". */
const DUNGEON_ITEMS: StoreFields = {
  read(text) {
    const fields: Fields = new Map();
    Object.entries(parseRecord<Record<string, unknown>>(text)).forEach(([dungeon, entry]) => {
      Object.entries(entry ?? {}).forEach(([field, value]) => {
        if (value) fields.set(`${dungeon}|${field}`, JSON.stringify(value));
      });
    });
    return fields;
  },
  write(text, edits) {
    const record = parseRecord<Record<string, unknown>>(text);
    Object.entries(edits).forEach(([key, value]) => {
      const split = key.lastIndexOf("|");
      const dungeon = key.slice(0, split);
      const field = key.slice(split + 1);
      const entry = { smallKeys: 0, bigKey: false, map: false, compass: false, ...record[dungeon] };
      record[dungeon] = { ...entry, [field]: value === null ? (field === "smallKeys" ? 0 : false) : parseJson(value) };
    });
    return JSON.stringify(record);
  }
};

/**
 * The Sphere Tracker's store: each location's placement, each entrance, each
 * marked sector, and the seed's random starting items as one list. A
 * placement is its item and location - its id is only a handle.
 */
const SPHERE: StoreFields = {
  read(text) {
    const state = toSphereState(parseJson(text));
    const fields: Fields = new Map();
    state.placements.forEach((placement) => {
      if (!placement?.item || !placement.location) return;
      fields.set(`placement|${locationKey(placement.location)}`, JSON.stringify({ item: placement.item, location: placement.location }));
    });
    Object.entries(state.entranceMappings).forEach(([dungeon, sector]) => sector && fields.set(`entrance|${dungeon}`, sector));
    Object.entries(state.entranceConnections).forEach(([entrance, target]) => target && fields.set(`connection|${entrance}`, target));
    state.highlightedSectors.forEach((sector) => fields.set(`sector|${locationKey(sector)}`, sector));
    if (state.randomStartingItems.length) fields.set("startingItems", JSON.stringify([...state.randomStartingItems].sort()));
    Object.entries(state.requiredBossOverrides).forEach(([boss, required]) => fields.set(`boss|${boss}`, String(Boolean(required))));
    return fields;
  },
  write(text, edits) {
    const state = toSphereState(parseJson(text));
    Object.entries(edits).forEach(([key, value]) => {
      const split = key.indexOf("|");
      const kind = split < 0 ? key : key.slice(0, split);
      const name = key.slice(split + 1);
      switch (kind) {
        case "placement": {
          const index = state.placements.findIndex((placement) => placement?.location && locationKey(placement.location) === name);
          if (value === null) {
            if (index >= 0) state.placements.splice(index, 1);
            break;
          }
          const { item, location } = parseJson(value) as { item: string; location: string };
          if (index >= 0) state.placements[index] = { ...state.placements[index], item, location };
          else state.placements.push({ id: `sphere-placement-0-host-${name.replace(/[^a-z0-9]+/g, "-")}`, item, location });
          break;
        }
        case "entrance":
          if (value === null) delete state.entranceMappings[name];
          else state.entranceMappings[name] = value;
          break;
        case "connection":
          if (value === null) delete state.entranceConnections[name];
          else state.entranceConnections[name] = value;
          break;
        case "sector":
          state.highlightedSectors = state.highlightedSectors.filter((sector) => locationKey(sector) !== name);
          if (value !== null) state.highlightedSectors.push(value);
          break;
        case "startingItems":
          state.randomStartingItems = value === null ? [] : (parseJson(value) as string[]);
          break;
        case "boss":
          if (value === null) delete state.requiredBossOverrides[name];
          else state.requiredBossOverrides[name] = value === "true";
          break;
      }
    });
    return JSON.stringify(state);
  }
};

const STORE_FIELDS: Record<EditableStore, StoreFields> = {
  notes: NOTES,
  checked: CHECKED,
  items: ITEMS,
  sphere: SPHERE,
  dungeonItems: DUNGEON_ITEMS
};

/** Each field `after` holds differently from `before`: its new value, or null where it went. */
function changedFields(before: Fields, after: Fields): Map<string, string | null> {
  const changed = new Map<string, string | null>();
  after.forEach((value, key) => before.get(key) !== value && changed.set(key, value));
  before.forEach((_, key) => !after.has(key) && changed.set(key, null));
  return changed;
}

/** What the host's tracker shows differently from the combined run: the host's edits. */
export function findRaceEdits(shown: RaceRunStores, merged: RaceRunStores, describe: DescribeNoteLine): RaceEdits {
  const edits: RaceEdits = {};
  EDITABLE_STORES.forEach((store) => {
    const fields = STORE_FIELDS[store];
    const changed = changedFields(fields.read(merged[store], describe), fields.read(shown[store], describe));
    if (changed.size) edits[store] = Object.fromEntries(changed);
  });
  return edits;
}

/** The combined run with the host's edits in it. */
export function applyRaceEdits(merged: RaceRunStores, edits: RaceEdits, describe: DescribeNoteLine): RaceRunStores {
  return Object.fromEntries(
    EDITABLE_STORES.map((store) => {
      const storeEdits = edits[store];
      return [store, storeEdits && Object.keys(storeEdits).length ? STORE_FIELDS[store].write(merged[store], storeEdits, describe) : merged[store]];
    })
  ) as RaceRunStores;
}

/**
 * The edits left once each runner's newest stores are in: a field a runner's
 * tracker has changed since `seen` goes back to what the runners say.
 */
export function dropUpdatedEdits(
  edits: RaceEdits,
  seen: Record<number, RaceSlotStores>,
  slots: Record<number, RaceSlotStores>,
  describe: DescribeNoteLine
): RaceEdits {
  const kept: RaceEdits = Object.fromEntries(Object.entries(edits).map(([store, fields]) => [store, { ...fields }]));
  Object.entries(slots).forEach(([slot, stores]) => {
    EDITABLE_STORES.forEach((store) => {
      const storeEdits = kept[store];
      const before = seen[Number(slot)]?.[store] ?? "";
      const after = stores[store] ?? "";
      if (!storeEdits || before === after) return;
      const fields = STORE_FIELDS[store];
      changedFields(fields.read(before, describe), fields.read(after, describe)).forEach((_, key) => delete storeEdits[key]);
    });
  });
  EDITABLE_STORES.forEach((store) => {
    if (kept[store] && !Object.keys(kept[store]!).length) delete kept[store];
  });
  return kept;
}

/** How many fields the host has corrected. */
export function countRaceEdits(edits: RaceEdits): number {
  return Object.values(edits).reduce((total, fields) => total + Object.keys(fields ?? {}).length, 0);
}
