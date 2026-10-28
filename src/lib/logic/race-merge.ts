// Combines the runs of every runner in a race into the one run the host's
// tracker holds. Everyone plays the same seed, so whatever one runner's
// tracker has found out - an item at a location, an entrance, a hint - holds
// for the others too, and the host's Sphere Tracker works from all of it.
//
// Ownership is combined as "the most any runner has", not added up: two
// runners who each found the Hookshot found the same Hookshot. Each runner's
// own inventory isn't lost by this - the stream display shows every runner
// from their own stores, never from the merged run.
import type { SpherePlacement, SphereState } from "$lib/state/sphere.svelte";
import type { DungeonItems } from "$lib/state/dungeon-items.svelte";

/** What a runner's tracker sends: one message per store, holding the store as saved. */
export const RACE_STORES = ["notes", "checked", "items", "sphere", "dungeonItems", "config", "display"] as const;
export type RaceStore = (typeof RACE_STORES)[number];
export type RaceSlotStores = Partial<Record<RaceStore, string>>;

export interface MergedRaceRun {
  notes: string;
  checked: Record<string, boolean>;
  items: Record<string, number>;
  sphere: SphereState;
  dungeonItems: Record<string, DungeonItems>;
  /** The seed's config.yaml - the first runner's that has one. */
  config: string;
  /** Where the runners' trackers disagree, worded for the host. */
  conflicts: string[];
}

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

function asRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

const lineKey = (line: string) => line.trim().toLowerCase();
const itemKey = (item: string) => item.trim().toLowerCase();

/** When a placement was recorded, read from its id - see addSpherePlacement. */
function placementTime(placement: SpherePlacement): number {
  return Number(/^sphere-placement-(\d+)-/.exec(placement.id)?.[1]) || 0;
}

interface Runner {
  slot: number;
  label: string;
  stores: RaceSlotStores;
}

/**
 * The first runner's notes as written, then each line another runner has
 * that isn't in yet.
 *
 * Repeats count: two identical path hints are two hints, so a line is added
 * until the notes hold it as often as the runner who has it most.
 */
function mergeNotes(runners: Runner[]): string {
  const notes = runners.map((runner) => runner.stores.notes ?? "").filter((text) => text.trim());
  if (!notes.length) return "";

  const lines = notes[0].trimEnd().split(/\r?\n/);
  const held = new Map<string, number>();
  const count = (map: Map<string, number>, line: string) => {
    const key = lineKey(line);
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };
  lines.forEach((line) => count(held, line));

  notes.slice(1).forEach((text) => {
    const seen = new Map<string, number>();
    text.split(/\r?\n/).forEach((line) => {
      const key = lineKey(line);
      if (!key) return;
      count(seen, line);
      if ((seen.get(key) ?? 0) <= (held.get(key) ?? 0)) return;
      lines.push(line.trimEnd());
      held.set(key, seen.get(key)!);
    });
  });
  return lines.join("\n");
}

/** One location holds one item, so two runners recording different ones is a mistake somewhere. */
function mergePlacements(runners: Runner[], sphereOf: (runner: Runner) => SphereState, conflicts: string[]): SpherePlacement[] {
  const byLocation = new Map<string, { placement: SpherePlacement; runner: Runner }>();
  const usedIds = new Set<string>();

  runners.forEach((runner) => {
    sphereOf(runner).placements.forEach((placement) => {
      if (!placement?.item || !placement.location) return;
      const key = itemKey(placement.location);
      const existing = byLocation.get(key);
      if (existing && itemKey(existing.placement.item) === itemKey(placement.item)) return;

      if (existing) {
        conflicts.push(
          `${placement.location}: ${existing.runner.label} has ${existing.placement.item}, ${runner.label} has ${placement.item}`
        );
        // The newer of the two is likelier to be a correction.
        if (placementTime(placement) <= placementTime(existing.placement)) return;
      }

      const id = usedIds.has(placement.id) ? `${placement.id}-${runner.slot}` : placement.id;
      usedIds.add(id);
      byLocation.set(key, { placement: { ...placement, id }, runner });
    });
  });
  return [...byLocation.values()].map(({ placement }) => placement);
}

/** Keys found by any runner, the first runner's answer kept where they differ. */
function mergeMaps(
  runners: Runner[],
  mapOf: (runner: Runner) => Record<string, string>,
  describe: (key: string) => string,
  conflicts: string[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  const owner: Record<string, Runner> = {};
  runners.forEach((runner) => {
    Object.entries(mapOf(runner)).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      if (!(key in merged)) {
        merged[key] = value;
        owner[key] = runner;
      } else if (merged[key] !== value) {
        conflicts.push(`${describe(key)}: ${owner[key].label} has ${merged[key]}, ${runner.label} has ${value}`);
      }
    });
  });
  return merged;
}

/** Each item as many times as the runner with the most copies has it, in first-seen order. */
function mergeMultiset(lists: string[][]): string[] {
  const merged: string[] = [];
  lists.forEach((list) => {
    const seen = new Map<string, number>();
    list.forEach((item) => {
      if (typeof item !== "string") return;
      const key = itemKey(item);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (merged.filter((candidate) => itemKey(candidate) === key).length < seen.get(key)!) merged.push(item);
    });
  });
  return merged;
}

/** A sphere store as sent, filled out the way loadSphereState fills out a stored one. */
export function toSphereState(value: unknown): SphereState {
  const stored = asRecord<unknown>(value);
  return {
    placements: asArray<SpherePlacement>(stored.placements),
    entranceMappings: asRecord<string>(stored.entranceMappings),
    entranceConnections: asRecord<string>(stored.entranceConnections),
    randomStartingItems: asArray<string>(stored.randomStartingItems),
    requiredBossOverrides: asRecord<boolean>(stored.requiredBossOverrides),
    highlightedSectors: asArray<string>(stored.highlightedSectors)
  };
}

/** Runner slots in order, each holding the latest value of each store it has sent. */
export function mergeRaceRuns(slots: Record<number, RaceSlotStores>): MergedRaceRun {
  const runners: Runner[] = Object.entries(slots)
    .map(([slot, stores]) => ({ slot: Number(slot), label: `Runner ${slot}`, stores }))
    .sort((a, b) => a.slot - b.slot);
  const conflicts: string[] = [];

  const spheres = new Map(runners.map((runner) => [runner, toSphereState(parseJson(runner.stores.sphere))]));
  const sphereOf = (runner: Runner) => spheres.get(runner)!;

  const checked: Record<string, boolean> = {};
  const items: Record<string, number> = {};
  const dungeonItems: Record<string, DungeonItems> = {};
  const requiredBossOverrides: Record<string, boolean> = {};
  const highlightedSectors = new Set<string>();

  runners.forEach((runner) => {
    Object.entries(asRecord<boolean>(parseJson(runner.stores.checked))).forEach(([key, value]) => {
      if (value) checked[key] = true;
    });

    Object.entries(asRecord<number>(parseJson(runner.stores.items))).forEach(([item, stage]) => {
      if (typeof stage === "number") items[item] = Math.max(items[item] ?? 0, stage);
    });

    Object.entries(asRecord<Partial<DungeonItems>>(parseJson(runner.stores.dungeonItems))).forEach(([dungeon, entry]) => {
      const current = dungeonItems[dungeon] ?? { smallKeys: 0, bigKey: false, map: false, compass: false };
      dungeonItems[dungeon] = {
        smallKeys: Math.max(current.smallKeys, Number(entry?.smallKeys) || 0),
        bigKey: current.bigKey || Boolean(entry?.bigKey),
        map: current.map || Boolean(entry?.map),
        compass: current.compass || Boolean(entry?.compass)
      };
    });

    // A boss one runner has marked required is required.
    Object.entries(sphereOf(runner).requiredBossOverrides).forEach(([boss, required]) => {
      requiredBossOverrides[boss] = Boolean(requiredBossOverrides[boss]) || Boolean(required);
    });
    sphereOf(runner).highlightedSectors.forEach((sector) => highlightedSectors.add(sector));
  });

  const configs = runners.filter((runner) => runner.stores.config?.trim());
  const config = configs[0]?.stores.config ?? "";
  configs.slice(1).forEach((runner) => {
    if (runner.stores.config!.trim() !== config.trim()) {
      conflicts.push(`${runner.label}'s seed settings differ from ${configs[0].label}'s`);
    }
  });

  return {
    notes: mergeNotes(runners),
    checked,
    items,
    sphere: {
      placements: mergePlacements(runners, sphereOf, conflicts),
      entranceMappings: mergeMaps(runners, (runner) => sphereOf(runner).entranceMappings, (dungeon) => dungeon, conflicts),
      entranceConnections: mergeMaps(runners, (runner) => sphereOf(runner).entranceConnections, (entrance) => entrance, conflicts),
      randomStartingItems: mergeMultiset(runners.map((runner) => sphereOf(runner).randomStartingItems)),
      requiredBossOverrides,
      highlightedSectors: [...highlightedSectors]
    },
    dungeonItems,
    config,
    conflicts
  };
}
