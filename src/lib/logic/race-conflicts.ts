// What the runners' trackers disagree on, for a race's host and admins to
// settle in the merged view (components/race/RaceConflictsWindow.svelte).
//
// - Two runners' trackers record different items at one location, or send an
//   entrance two places. The merge keeps one answer (logic/race-merge.ts), and
//   the conflict stands until someone says which is right - a correction there,
//   or a resolution marking it settled as these runners have it now. When a
//   runner's tracker changes its answer, it's a new disagreement.
// - The merged view has an item placed more times than the seed has copies of
//   it: one Hookshot at two locations, a fifth bottle. That settles itself once
//   enough of the placements are gone.
// - A runner's tracker on other seed settings than the race's. Nothing to
//   choose there - their tracker takes the host's by itself.
import { toSphereState, type RaceSlotStores } from "$lib/logic/race-merge";
import { placementCorrection, type RaceEdits, type RaceRunStores } from "$lib/logic/race-edits";

/** One of the answers a conflict can be settled with, and which runners' trackers gave it. */
export interface RaceConflictChoice {
  value: string;
  runners: string[];
}

export interface RaceConflictPlacement {
  item: string;
  location: string;
  /** The runners whose trackers recorded it - none for one the host or an admin put there. */
  runners: string[];
}

export type RaceConflict =
  | { kind: "location"; key: string; signature: string; location: string; choices: RaceConflictChoice[] }
  | { kind: "entrance"; key: string; signature: string; field: string; name: string; choices: RaceConflictChoice[] }
  | { kind: "copies"; key: string; item: string; copies: number; placements: RaceConflictPlacement[] }
  | { kind: "settings"; key: string; runners: string[] };

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** Each runner's answer for each key, grouped: key -> answer -> the runners who gave it. */
function gatherAnswers(answersOf: Array<{ runner: string; answers: Array<[string, string, string]> }>) {
  // key -> { label, answers: answerKey -> { value, runners } }
  const gathered = new Map<string, { label: string; answers: Map<string, RaceConflictChoice> }>();
  answersOf.forEach(({ runner, answers }) => {
    answers.forEach(([key, label, value]) => {
      const entry = gathered.get(key) ?? { label, answers: new Map() };
      gathered.set(key, entry);
      const choice = entry.answers.get(nameKey(value)) ?? { value, runners: [] };
      entry.answers.set(nameKey(value), choice);
      if (!choice.runners.includes(runner)) choice.runners.push(runner);
    });
  });
  return gathered;
}

/** Which answers a conflict was between, to tell a settled one from a new one. */
function signatureOf(choices: RaceConflictChoice[]): string {
  return choices
    .map((choice) => nameKey(choice.value))
    .sort()
    .join("|");
}

export function findRaceConflicts({
  slots,
  shown,
  edits,
  raceConfig,
  name,
  copiesOf
}: {
  /** Each runner's stores, as their tracker sent them. */
  slots: Record<number, RaceSlotStores>;
  /** The merged view: the combined run with its corrections. */
  shown: RaceRunStores;
  edits: RaceEdits;
  /** The race's seed config - the host's. */
  raceConfig: string;
  name: (slot: number) => string;
  /** How many copies of an item the seed hides at locations. */
  copiesOf: (item: string) => number;
}): RaceConflict[] {
  const conflicts: RaceConflict[] = [];
  const runners = Object.entries(slots)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([slot, stores]) => ({ runner: name(Number(slot)), stores, sphere: toSphereState(parseJson(stores.sphere)) }));
  const sphereEdits = edits.sphere ?? {};
  const settled = (key: string, field: string, signature: string) => field in sphereEdits || edits.resolved?.[key] === signature;

  // Different items at one location.
  const atLocations = gatherAnswers(
    runners.map(({ runner, sphere }) => ({
      runner,
      answers: sphere.placements
        .filter((placement) => placement?.item && placement.location)
        .map((placement): [string, string, string] => [nameKey(placement.location), placement.location, placement.item])
    }))
  );
  atLocations.forEach(({ label, answers }, location) => {
    if (answers.size < 2) return;
    const choices = [...answers.values()];
    const key = `location|${location}`;
    const signature = signatureOf(choices);
    if (!settled(key, placementCorrection(label, null)[0], signature)) conflicts.push({ kind: "location", key, signature, location: label, choices });
  });

  // An entrance sent two places.
  (["entranceMappings", "entranceConnections"] as const).forEach((map) => {
    const prefix = map === "entranceMappings" ? "entrance" : "connection";
    const sent = gatherAnswers(
      runners.map(({ runner, sphere }) => ({
        runner,
        answers: Object.entries(sphere[map])
          .filter(([, target]) => typeof target === "string" && target)
          .map(([entrance, target]): [string, string, string] => [entrance, entrance, target])
      }))
    );
    sent.forEach(({ label, answers }, entrance) => {
      if (answers.size < 2) return;
      const choices = [...answers.values()];
      const key = `${prefix}|${entrance}`;
      const signature = signatureOf(choices);
      if (!settled(key, key, signature)) conflicts.push({ kind: "entrance", key, signature, field: key, name: label, choices });
    });
  });

  // More of an item placed than the seed has.
  const placed = new Map<string, RaceConflictPlacement[]>();
  toSphereState(parseJson(shown.sphere)).placements.forEach((placement) => {
    if (!placement?.item || !placement.location) return;
    const recordedBy = runners
      .filter(({ sphere }) =>
        sphere.placements.some(
          (theirs) => theirs?.item && nameKey(theirs.item) === nameKey(placement.item) && nameKey(theirs.location ?? "") === nameKey(placement.location)
        )
      )
      .map(({ runner }) => runner);
    const list = placed.get(nameKey(placement.item)) ?? [];
    placed.set(nameKey(placement.item), [...list, { item: placement.item, location: placement.location, runners: recordedBy }]);
  });
  placed.forEach((placements, item) => {
    const copies = copiesOf(placements[0].item);
    if (placements.length > copies) conflicts.push({ kind: "copies", key: `copies|${item}`, item: placements[0].item, copies, placements });
  });

  // A tracker on other seed settings. Without the host's, the first runner's are the race's.
  const configured = runners.filter(({ stores }) => stores.config?.trim());
  const config = raceConfig.trim() || configured[0]?.stores.config?.trim() || "";
  const differing = configured.filter(({ stores }) => stores.config!.trim() !== config).map(({ runner }) => runner);
  if (differing.length) conflicts.push({ kind: "settings", key: "settings", runners: differing });

  return conflicts;
}

/** "Ari and Bea" */
function listRunners(runners: string[]): string {
  return runners.length > 1 ? `${runners.slice(0, -1).join(", ")} and ${runners[runners.length - 1]}` : (runners[0] ?? "");
}

function describeChoices(choices: RaceConflictChoice[]): string {
  return choices.map((choice) => `${listRunners(choice.runners)} ${choice.runners.length > 1 ? "have" : "has"} ${choice.value}`).join(", ");
}

/** A conflict in a line, as the list shows it. */
export function describeRaceConflict(conflict: RaceConflict): string {
  switch (conflict.kind) {
    case "location":
      return `${conflict.location}: ${describeChoices(conflict.choices)}`;
    case "entrance":
      return `${conflict.name}: ${describeChoices(conflict.choices)}`;
    case "copies":
      return `${conflict.item} is placed at ${conflict.placements.length} locations, but the seed has ${conflict.copies === 1 ? "one" : conflict.copies}`;
    case "settings":
      return `${listRunners(conflict.runners)} ${conflict.runners.length > 1 ? "are" : "is"} on other seed settings than the race's`;
  }
}
