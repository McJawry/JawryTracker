// The multi-boss path-hint rule, kept apart from the tree-walking in
// sphere-boss-icons.ts so it stays free of app state and can be tested on its
// own. An area hinted as the path to several bosses holds a *separate* path
// item for each - confirmed with the randomizer developers - which is what
// every rule below is ultimately derived from.

export interface AreaBranchModel {
  /** Boss -> the area's own items that could be its path item. */
  candidatesByBoss: Map<string, string[]>;
  /** Each unchecked location in the tree, and the branches it hangs off. */
  locations: Array<{ key: string; branches: Set<string> }>;
  /** Branches that still have unchecked locations under them. */
  openRootIds: Set<string>;
}

/**
 * Works out what the bosses are paired against.
 *
 * Each item the hinted area itself holds roots a branch. What a branch is
 * required for is decided by that item *or anything downstream of it*, but the
 * item a path hint names is always one of the area's own - so those, and only
 * those, are the candidates. Pairing bosses against downstream items instead
 * builds a matching out of items the hint could never have meant: two of them
 * settle both bosses between them and every icon disappears, while the area's
 * own items are still unaccounted for.
 */
export function buildAreaBranchModel(input: {
  bosses: string[];
  rootIds: string[];
  placementIds: string[];
  dependenciesOf: (placementId: string) => string[];
  isHardRequired: (placementId: string, bossName: string) => boolean;
  availableLocations: string[];
  locationDependenciesOf: (location: string) => string[];
}): AreaBranchModel {
  const { bosses, rootIds, placementIds, dependenciesOf, isHardRequired, availableLocations, locationDependenciesOf } = input;

  // Which branches each placement hangs off, spread along the dependency edges
  // until it stops changing.
  const rootsByPlacement = new Map<string, Set<string>>(rootIds.map((rootId) => [rootId, new Set([rootId])]));
  let spreading = true;
  while (spreading) {
    spreading = false;
    placementIds.forEach((placementId) => {
      const inherited = new Set(rootsByPlacement.get(placementId) ?? []);
      const before = inherited.size;
      dependenciesOf(placementId).forEach((sourceId) => (rootsByPlacement.get(sourceId) ?? new Set<string>()).forEach((rootId) => inherited.add(rootId)));
      if (inherited.size === before) return;
      rootsByPlacement.set(placementId, inherited);
      spreading = true;
    });
  }

  const branchBosses = new Map<string, string[]>(
    rootIds.map((rootId) => [
      rootId,
      bosses.filter((bossName) =>
        placementIds.some((placementId) => (rootsByPlacement.get(placementId)?.has(rootId) ?? false) && isHardRequired(placementId, bossName))
      )
    ])
  );

  const branchesFor = (location: string): Set<string> => {
    const roots = new Set<string>();
    locationDependenciesOf(location).forEach((sourceId) => (rootsByPlacement.get(sourceId) ?? new Set<string>()).forEach((rootId) => roots.add(rootId)));
    return roots;
  };
  const locations = availableLocations.map((location) => ({ key: location, branches: branchesFor(location) }));
  // A branch with unchecked locations still hanging off it is open: it can
  // still turn out to hold something it is not yet known to.
  const openRootIds = new Set<string>();
  locations.forEach((location) => location.branches.forEach((rootId) => openRootIds.add(rootId)));

  return {
    candidatesByBoss: new Map(bosses.map((bossName) => [bossName, rootIds.filter((rootId) => (branchBosses.get(rootId) ?? []).includes(bossName))])),
    locations,
    openRootIds
  };
}

/**
 * Which bosses each available location is still a candidate for, given what
 * every branch of the hinted area is known to be required for.
 *
 * Split out from the tree-walking above so the rule itself can be exercised
 * directly: it is pure, and the scenarios it has to satisfy are specific.
 */
export function planPathBossIcons(
  bosses: string[],
  candidatesByBoss: Map<string, string[]>,
  locations: Array<{ key: string; branches: Set<string> }>,
  openRootIds: Set<string>
): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  const add = (key: string, bossName: string) => {
    const list = plan.get(key) ?? [];
    if (!list.includes(bossName)) list.push(bossName);
    plan.set(key, list);
  };

  const unresolvedBosses = getUnresolvedPathBosses(bosses, candidatesByBoss);
  // Every boss paired off against a branch of its own: each path item is
  // already in hand, so nothing here is worth searching and no icon is drawn.
  if (!unresolvedBosses.length) return plan;

  locations.forEach((location) => unresolvedBosses.forEach((bossName) => add(location.key, bossName)));

  // A boss the matching did settle, but only onto branches that are still
  // open, is not settled firmly: such a branch could yet prove required for
  // another boss too, which would hand this one back to a different branch. So
  // it keeps its icon everywhere except the branches that answer it - there,
  // the item that answers it is already in hand. A closed branch settles the
  // boss for good and stops this.
  bosses
    .filter((bossName) => !unresolvedBosses.includes(bossName))
    .forEach((bossName) => {
      const resolvers = candidatesByBoss.get(bossName) ?? [];
      if (!resolvers.length || resolvers.some((rootId) => !openRootIds.has(rootId))) return;
      locations.forEach((location) => {
        if (resolvers.some((rootId) => location.branches.has(rootId))) return;
        add(location.key, bossName);
      });
    });

  return plan;
}

/**
 * Which of an area's hinted bosses still have an unaccounted-for path item.
 *
 * An area hinted to several bosses holds a separate path item for each, so a
 * single item cannot resolve two of them - if the Bow is hard-required for
 * both bosses it is still only *one* boss's path item, and the other's is a
 * different item in the same tree. Pairing bosses to the items that could be
 * theirs is therefore a bipartite matching, one item to at most one boss.
 *
 * A boss counts as unresolved when some maximum matching leaves it unpaired:
 * the pairing is then not forced, so that boss might be the one still looking.
 * Two bosses sharing one hard-required item leave both unresolved that way,
 * which is why the tree's locations show both icons - either boss could be the
 * one that item belongs to.
 */
function getUnresolvedPathBosses(bosses: string[], candidates: Map<string, string[]>): string[] {
  const maxMatching = (subset: string[]): number => {
    const bossForItem = new Map<string, string>();
    const assign = (bossName: string, tried: Set<string>): boolean =>
      (candidates.get(bossName) || []).some((sourceId) => {
        if (tried.has(sourceId)) return false;
        tried.add(sourceId);
        const holder = bossForItem.get(sourceId);
        if (holder !== undefined && !assign(holder, tried)) return false;
        bossForItem.set(sourceId, bossName);
        return true;
      });
    return subset.filter((bossName) => assign(bossName, new Set())).length;
  };

  const paired = maxMatching(bosses);
  return bosses.filter((bossName) => maxMatching(bosses.filter((other) => other !== bossName)) === paired);
}
