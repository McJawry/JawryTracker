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
  /** The seed's config.yaml: the host's, or without one the first runner's. */
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

const itemKey = (item: string) => item.trim().toLowerCase();

/**
 * A note line as the merged notes write it: `key` says which hint it is, so
 * two lines with the same key are the same hint however they were typed, and
 * `tagged` says it names the item's requirement, which makes it the better of
 * the two. The host's tracker reads lines with the hint parser
 * (logic/hint-canonical.ts); without it, a line is only the same as another
 * typed the same way.
 */
export interface NoteLine {
  text: string;
  key: string;
  tagged: boolean;
}

export type DescribeNoteLine = (line: string) => NoteLine;

const asTyped: DescribeNoteLine = (line) => ({ text: line.trimEnd(), key: line.trim().toLowerCase(), tagged: false });

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
 * The first runner's notes in their order, then each hint another runner has
 * that isn't in yet - every line in the spelling `describe` gives it.
 *
 * The same hint from two runners is one hint: each found it. The same hint
 * twice from one runner is two - the seed can give a path hint twice, a
 * second path item in that area - so a hint is added until the notes hold it
 * as often as the runner who wrote it most. A hint already in without its
 * requirement takes the tag from a runner who wrote it.
 */
function mergeNotes(runners: Runner[], describe: DescribeNoteLine): string {
  const notes = runners.map((runner) => runner.stores.notes ?? "").filter((text) => text.trim());
  if (!notes.length) return "";
  const described = notes.map((text) => text.trimEnd().split(/\r?\n/).map((line) => (line.trim() ? describe(line) : null)));

  // Blank lines stay where the first runner put them, as spacing.
  const lines: NoteLine[] = described[0].map((line) => line ?? { text: "", key: "", tagged: false });
  const held = new Map<string, number>();
  lines.forEach(({ key }) => key && held.set(key, (held.get(key) ?? 0) + 1));

  described.slice(1).forEach((runnerLines) => {
    const seen = new Map<string, number>();
    runnerLines.forEach((line) => {
      if (!line) return;
      const count = (seen.get(line.key) ?? 0) + 1;
      seen.set(line.key, count);
      if (count > (held.get(line.key) ?? 0)) {
        lines.push(line);
        held.set(line.key, count);
      } else if (line.tagged) {
        const untagged = lines.find((candidate) => candidate.key === line.key && !candidate.tagged);
        if (untagged) Object.assign(untagged, line);
      }
    });
  });
  return lines.map(({ text }) => text).join("\n");
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

/**
 * Runner slots in order, each holding the latest value of each store it has
 * sent, and the host's own seed config - which every runner should be on.
 * `describeLine` tells what each note line means; see NoteLine. `name` is
 * what the conflicts call each runner.
 */
export function mergeRaceRuns(
  slots: Record<number, RaceSlotStores>,
  hostConfig = "",
  describeLine: DescribeNoteLine = asTyped,
  name: (slot: number) => string = (slot) => `Runner ${slot}`
): MergedRaceRun {
  const runners: Runner[] = Object.entries(slots)
    .map(([slot, stores]) => ({ slot: Number(slot), label: name(Number(slot)), stores }))
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

  // The host's seed config is the race's. Only a host without one falls back
  // on a runner's.
  const configs = runners.filter((runner) => runner.stores.config?.trim());
  const fromHost = Boolean(hostConfig.trim());
  const config = fromHost ? hostConfig : (configs[0]?.stores.config ?? "");
  const owner = fromHost ? "the host's" : `${configs[0]?.label}'s`;
  configs.forEach((runner) => {
    if (runner.stores.config!.trim() !== config.trim()) conflicts.push(`${runner.label}'s seed settings differ from ${owner}`);
  });

  return {
    notes: mergeNotes(runners, describeLine),
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
