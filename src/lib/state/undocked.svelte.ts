// Which sections are currently popped out into their own window. Persisted
// (both to localStorage and into the layout preferences file) so the same
// windows reopen on the next launch, alongside panel sizes and hidden state.
export const UNDOCKED_KEY = "ww-rando-hint-tracker-undocked";

function loadUndocked(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(UNDOCKED_KEY) || "null");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export const undockedState: { ids: string[] } = $state({ ids: loadUndocked() });

/** Re-reads from localStorage without writing back (see storage-sync.ts). */
export function reloadUndockedFromStorage(): void {
  undockedState.ids = loadUndocked();
}

export function saveUndockedState(): void {
  localStorage.setItem(UNDOCKED_KEY, JSON.stringify(undockedState.ids));
}

// When each section was last asked to pop out. Creating a window takes a
// moment - longer than the reconcile interval - and until it exists the
// reconcile below cannot tell "opening" from "closed", so it used to conclude
// the panel had been docked and put it back in the layout while its window
// was still on its way. Kept here, beside the list it protects, so it is one
// shared record no matter how many copies of the other modules are loaded.
const undockRequestedAt = new Map<string, number>();
const OPENING_GRACE_MS = 15000;

/** Whether this section's window is still within its opening grace period. */
export function isUndockPending(sectionId: string): boolean {
  const requested = undockRequestedAt.get(sectionId);
  return requested !== undefined && Date.now() - requested < OPENING_GRACE_MS;
}

export function markUndocked(sectionId: string): void {
  undockRequestedAt.set(sectionId, Date.now());
  if (undockedState.ids.includes(sectionId)) return;
  undockedState.ids = [...undockedState.ids, sectionId];
  saveUndockedState();
}

export function markDocked(sectionId: string): void {
  undockRequestedAt.delete(sectionId);
  if (!undockedState.ids.includes(sectionId)) return;
  undockedState.ids = undockedState.ids.filter((id) => id !== sectionId);
  saveUndockedState();
}


export function setUndockedIds(ids: string[]): void {
  undockedState.ids = [...ids];
  saveUndockedState();
}
