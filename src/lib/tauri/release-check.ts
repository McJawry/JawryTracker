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

/** "v1.2.3" / "1.2.3-beta" -> comparable numeric parts. */
function parseVersion(value: string): number[] {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
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
