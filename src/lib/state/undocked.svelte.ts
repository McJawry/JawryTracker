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

export function markUndocked(sectionId: string): void {
  if (undockedState.ids.includes(sectionId)) return;
  undockedState.ids = [...undockedState.ids, sectionId];
  saveUndockedState();
}

export function markDocked(sectionId: string): void {
  if (!undockedState.ids.includes(sectionId)) return;
  undockedState.ids = undockedState.ids.filter((id) => id !== sectionId);
  saveUndockedState();
}

export function setUndockedIds(ids: string[]): void {
  undockedState.ids = [...ids];
  saveUndockedState();
}
