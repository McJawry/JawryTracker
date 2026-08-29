// Open/closed state of the sphere board's per-area panels, shared by every
// window that renders a board.
//
// Ported from sphereAreaGroupOpenState / sphereAreaGroupsDefaultOpen /
// toggleAllSphereAreaGroups (dev/app/app.js:4386). Module-level rather than
// component-level so a group keeps its state across re-renders - the board
// rebuilds its columns on every analysis, which would otherwise spring every
// panel back open mid-run.
// A plain object, not a Map: $state tracks an object's keys deeply, while a
// Map's .set()/.clear() produce no invalidation at all - collapsing worked
// (it also flipped defaultOpen) but expanding silently did nothing.
const openByNodeId: Record<string, boolean> = $state({});

let defaultOpen = $state(true);

export function isSphereGroupOpen(nodeId: string): boolean {
  return openByNodeId[nodeId] ?? defaultOpen;
}

export function setSphereGroupOpen(nodeId: string, open: boolean): void {
  openByNodeId[nodeId] = open;
}

/** True when at least one panel is closed, i.e. the button should expand. */
export function shouldExpandSphereGroups(nodeIds: string[]): boolean {
  return nodeIds.some((nodeId) => !isSphereGroupOpen(nodeId));
}

/** One button for the whole board: expand everything, or collapse everything. */
export function toggleAllSphereGroups(nodeIds: string[]): void {
  const expand = shouldExpandSphereGroups(nodeIds);
  defaultOpen = expand;
  Object.keys(openByNodeId).forEach((key) => delete openByNodeId[key]);
  nodeIds.forEach((nodeId) => (openByNodeId[nodeId] = expand));
}
