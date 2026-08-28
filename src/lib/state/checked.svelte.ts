import { CHECKED_KEY } from "$lib/constants";

export function loadChecked(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CHECKED_KEY) || "null") || {};
  } catch {
    return {};
  }
}

export const checked: Record<string, boolean> = $state(loadChecked());

export function saveChecked(): void {
  localStorage.setItem(CHECKED_KEY, JSON.stringify(checked));
}

export function setChecked(key: string, value: boolean): void {
  checked[key] = value;
  saveChecked();
}
