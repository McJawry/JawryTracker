// Race Tracking: several trackers linked over the relay (relay/ in this repo)
// for a race shown on one stream. Each runner's tracker operator sends their
// run; the host's tracker combines them into its own (logic/race-merge.ts)
// and serves each runner's items to OBS (RaceStreamDisplay.svelte).
//
// Set up from the Settings window but run by the main window
// (tauri/race-link.svelte.ts), so these two stores are how they talk: the
// session says what to connect to, the status says how it is going.
import { RACE_SESSION_KEY, RACE_STATUS_KEY } from "$lib/constants";

export interface RaceSession {
  role: "host" | "runner";
  relay: string;
  room: string;
  /** The host key, or this runner's own key. */
  key: string;
  /** This runner's slot, or how many runners the host's room has. */
  slot: number;
  /** Host only: every runner's key, for handing out their codes. */
  runnerKeys?: string[];
}

export interface RaceRunnerStatus {
  online: boolean;
  /** When this runner's tracker last sent anything, or 0 if it never has. */
  updatedAt: number;
}

export interface RaceStatus {
  connected: boolean;
  message: string;
  /** Host only, by slot. */
  runners: Record<number, RaceRunnerStatus>;
  /** Host only: where the runners' trackers disagree. */
  conflicts: string[];
  /** Host only: why the stream display can't be served, if it can't. */
  display: string;
}

const IDLE_STATUS: RaceStatus = { connected: false, message: "", runners: {}, conflicts: [], display: "" };

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function loadSession(): RaceSession | null {
  const stored = readJson<RaceSession>(RACE_SESSION_KEY);
  return stored?.room && stored.key && (stored.role === "host" || stored.role === "runner") ? stored : null;
}

function loadStatus(): RaceStatus {
  return { ...IDLE_STATUS, ...readJson<RaceStatus>(RACE_STATUS_KEY) };
}

export const race: { session: RaceSession | null; status: RaceStatus } = $state({
  session: loadSession(),
  status: loadStatus()
});

export function setRaceSession(session: RaceSession | null): void {
  race.session = session;
  if (session) localStorage.setItem(RACE_SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(RACE_SESSION_KEY);
}

export function setRaceStatus(status: Partial<RaceStatus>): void {
  race.status = { ...race.status, ...status };
  localStorage.setItem(RACE_STATUS_KEY, JSON.stringify(race.status));
}

export function resetRaceStatus(): void {
  setRaceStatus({ ...IDLE_STATUS });
}

export function reloadRaceSessionFromStorage(): void {
  race.session = loadSession();
}

export function reloadRaceStatusFromStorage(): void {
  race.status = loadStatus();
}

/**
 * A runner's code, as the host hands it out: room, slot and key in one string
 * that can be pasted whole - "79RVYS-1-ABCDEFGHJKLM".
 */
export function formatRunnerCode(room: string, slot: number, key: string): string {
  return `${room}-${slot}-${key}`;
}

export function parseRunnerCode(text: string): { room: string; slot: number; key: string } | null {
  const match = /^([A-Z0-9]{6})-([1-9])-([A-Z0-9]{12})$/.exec(text.trim().toUpperCase().replace(/\s+/g, ""));
  return match ? { room: match[1], slot: Number(match[2]), key: match[3] } : null;
}
