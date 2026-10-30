// Race Tracking: several trackers linked over the relay (relay/ in this repo)
// for a race shown on one stream. Each runner's tracker operator sends their
// run; the host's tracker combines them into its own (logic/race-merge.ts)
// and serves each runner's items to OBS (RaceStreamDisplay.svelte). An
// admin's tracker - someone helping run the race - combines them the same
// way, and corrects the combined run along with the host.
//
// Set up from the Settings window but run by the main window
// (tauri/race-link.svelte.ts), so these stores are how they talk: the session
// says what to connect to, the status says how it is going, and a host's view
// says whose run to show.
import { RACE_RESOLVE_KEY, RACE_ROSTER_KEY, RACE_SESSION_KEY, RACE_STATUS_KEY, RACE_VIEW_KEY } from "$lib/constants";
import type { RaceConflict } from "$lib/logic/race-conflicts";

export interface RaceSession {
  role: "host" | "admin" | "runner";
  relay: string;
  room: string;
  /** The host key, or this runner's own key. */
  key: string;
  /** This runner's slot, or how many runners the room has. */
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
  /** Host and admin: what the runners' trackers disagree on. */
  conflicts: RaceConflict[];
  /** Host only: why the stream display can't be served, if it can't. */
  display: string;
  /** Host and admin: how many things are corrected in the combined run. */
  edits: number;
  /** Host only: the room's admin key, once the relay has sent it - a relay from before admins doesn't. */
  adminKey: string;
}

const IDLE_STATUS: RaceStatus = { connected: false, message: "", runners: {}, conflicts: [], display: "", edits: 0, adminKey: "" };

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function loadSession(): RaceSession | null {
  const stored = readJson<RaceSession>(RACE_SESSION_KEY);
  return stored?.room && stored.key && ["host", "admin", "runner"].includes(stored.role) ? stored : null;
}

function loadStatus(): RaceStatus {
  return { ...IDLE_STATUS, ...readJson<RaceStatus>(RACE_STATUS_KEY) };
}

/**
 * What the host sets for each runner, which the room passes on: a name to
 * tell them apart by, and whether the host or an admin can track for them
 * while their own tracker is offline.
 */
export interface RaceRoster {
  /** The room this is for - a new room starts with none. */
  room: string;
  names: Record<number, string>;
  editable: number[];
}

/**
 * A conflict settled from the Race conflicts window, which the main window
 * applies to the merged view (tauri/race-link.svelte.ts).
 */
export interface RaceResolution {
  /** Tells one request from the next. */
  id: string;
  key: string;
  /** Settles the conflict as the runners' trackers have it now - see logic/race-conflicts.ts. */
  signature?: string;
  /** Corrections to the merged view's Sphere Tracker store, by field. */
  sphere: Record<string, string | null>;
}

function loadView(): number {
  return Number(localStorage.getItem(RACE_VIEW_KEY)) || 0;
}

function loadRoster(): RaceRoster {
  const stored = readJson<Partial<RaceRoster>>(RACE_ROSTER_KEY);
  return { room: stored?.room ?? "", names: stored?.names ?? {}, editable: stored?.editable ?? [] };
}

export const race: {
  session: RaceSession | null;
  status: RaceStatus;
  /** Host and admin: whose run the tracker shows - 0 for the runners' combined, else a runner's slot. */
  view: number;
  roster: RaceRoster;
  resolution: RaceResolution | null;
} = $state({
  session: loadSession(),
  status: loadStatus(),
  view: loadView(),
  roster: loadRoster(),
  resolution: readJson<RaceResolution>(RACE_RESOLVE_KEY)
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

export function setRaceView(view: number): void {
  race.view = view;
  localStorage.setItem(RACE_VIEW_KEY, String(view));
}

export function reloadRaceViewFromStorage(): void {
  race.view = loadView();
}

/** This race's roster - an empty one if what's kept is another room's. */
export function currentRaceRoster(): RaceRoster {
  const room = race.session?.room ?? "";
  return race.roster.room === room ? race.roster : { room, names: {}, editable: [] };
}

export function setRaceRoster(roster: RaceRoster): void {
  const stored = JSON.stringify(roster);
  if (stored === JSON.stringify(race.roster)) return;
  race.roster = roster;
  localStorage.setItem(RACE_ROSTER_KEY, stored);
}

export function reloadRaceRosterFromStorage(): void {
  race.roster = loadRoster();
}

export function requestRaceResolution(resolution: Omit<RaceResolution, "id">): void {
  const request = { ...resolution, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
  race.resolution = request;
  localStorage.setItem(RACE_RESOLVE_KEY, JSON.stringify(request));
}

export function reloadRaceResolutionFromStorage(): void {
  race.resolution = readJson<RaceResolution>(RACE_RESOLVE_KEY);
}

/** A runner as the trackers show them: by the host's name for them, or as "Runner 2". */
export function runnerName(slot: number): string {
  return currentRaceRoster().names[slot]?.trim() || `Runner ${slot}`;
}

/**
 * Whether this tracker can track for a runner: it's the host's or an admin's,
 * the host has let the runner be tracked for, and the runner's own tracker is
 * offline.
 */
export function canTrackForRunner(slot: number): boolean {
  const role = race.session?.role;
  return (
    (role === "host" || role === "admin") && currentRaceRoster().editable.includes(slot) && !race.status.runners[slot]?.online
  );
}

/** Whether the run shown is only to look at: a runner's this tracker can't track for. */
export function isRaceViewReadOnly(): boolean {
  return race.view > 0 && !canTrackForRunner(race.view);
}

/**
 * A runner's code, as the host hands it out: room, slot and key in one string
 * that can be pasted whole - "79RVYS-1-ABCDEFGHJKLM".
 */
export function formatRunnerCode(room: string, slot: number, key: string): string {
  return `${room}-${slot}-${key}`;
}

/** The admin's code: a runner's with an A for the slot - "79RVYS-A-ABCDEFGHJKLM". */
export function formatAdminCode(room: string, key: string): string {
  return `${room}-A-${key}`;
}

/** A runner's code, or an admin's - which has no slot. */
export function parseRaceCode(text: string): { room: string; slot: number | null; key: string } | null {
  const match = /^([A-Z0-9]{6})-([1-9]|A)-([A-Z0-9]{12})$/.exec(text.trim().toUpperCase().replace(/\s+/g, ""));
  return match ? { room: match[1], slot: match[2] === "A" ? null : Number(match[2]), key: match[3] } : null;
}
