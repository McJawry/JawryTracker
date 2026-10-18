// "A newer release exists on GitHub" notice.
//
// This is not the Tauri updater (shelved - see BUILDING.md): it never
// downloads or installs anything, so it works fine with a portable build that
// can't replace its own executable. It reads the public Releases API, compares
// tags, and offers a link.
//
// Plain fetch rather than a Tauri HTTP plugin: the GitHub API sends
// `Access-Control-Allow-Origin: *`, so the webview can call it directly with
// no extra plugin, permission or rebuild.
import { APP_VERSION } from "$lib/constants";

const RELEASES_API = "https://api.github.com/repos/McJawry/JawryTracker/releases/latest";
const RELEASES_PAGE = "https://github.com/McJawry/JawryTracker/releases/latest";

export interface ReleaseInfo {
  version: string;
  url: string;
  notes: string;
}

/**
 * "v1.2.3-beta.1+build" -> the release numbers and the test suffix. Build
 * metadata (after "+") never decides which version is newer, so it is dropped.
 */
function parseVersion(value: string): { release: number[]; preRelease: string[] } {
  const [core, ...suffix] = String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split("+")[0]
    .split("-");
  return {
    release: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    preRelease: suffix.length ? suffix.join("-").split(".") : []
  };
}

/** semver's order for two test suffixes: numbers by value, words by text, numbers first. */
function comparePreRelease(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    // More identifiers is later, when all before them are equal: beta.1.1 > beta.1.
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) - Number(b);
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Whether `candidate` comes after `current`, in semver's order: 0.2.7 is newer
 * than 0.2.7-beta.1, which is newer than 0.2.6. Reading the test suffix as one
 * more number made 0.2.7-beta.1 look newer than 0.2.7 itself, so a tester was
 * never told the real release was out.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  const length = Math.max(left.release.length, right.release.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.release[index] ?? 0;
    const b = right.release[index] ?? 0;
    if (a !== b) return a > b;
  }
  // Same release numbers: the finished release beats any test version of it.
  if (!left.preRelease.length || !right.preRelease.length) return !left.preRelease.length && right.preRelease.length > 0;
  return comparePreRelease(left.preRelease, right.preRelease) > 0;
}

/**
 * Returns the newer release, or null when up to date. Never throws - being
 * offline, rate-limited, or having published no releases yet are all normal
 * and must not interrupt a run.
 */
export async function checkForNewerRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    // 404 = no releases published yet; 403 = unauthenticated rate limit.
    if (!response.ok) return null;

    const release = (await response.json()) as { tag_name?: string; html_url?: string; body?: string; draft?: boolean; prerelease?: boolean };
    if (!release?.tag_name || release.draft) return null;
    if (!isNewerVersion(release.tag_name, APP_VERSION)) return null;

    return {
      version: release.tag_name.replace(/^v/i, ""),
      url: release.html_url || RELEASES_PAGE,
      notes: (release.body || "").trim()
    };
  } catch (error) {
    console.error("Release check failed", error);
    return null;
  }
}

export async function openReleasePage(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (error) {
    console.error("Could not open the release page", error);
  }
}
