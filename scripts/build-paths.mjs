// Where the build scripts find things: the repo, the app's version, and the
// builds/ folder the release artifacts are copied into. Shared so the scripts
// that write builds and the one that checks them can't disagree.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function readTauriConfig() {
  return JSON.parse(await readFile(join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
}

/**
 * The version being built. tauri.conf.json's "version" may be a literal
 * semver or a path to a package.json to read it from - follow the path when
 * that's what it is.
 */
export async function readAppVersion() {
  const tauriConfig = await readTauriConfig();
  return /^\d/.test(tauriConfig.version)
    ? tauriConfig.version
    : JSON.parse(await readFile(resolve(projectRoot, "src-tauri", tauriConfig.version), "utf8")).version;
}

/**
 * APP/builds sits deliberately outside the repo (see BUILDING.md), so its
 * location is found by walking up from the project root rather than by a fixed
 * number of "..". The repo has already moved once - APP/dev to
 * APP/github/JawryTracker-dev - and a hard-coded hop count silently started
 * writing builds into the wrong folder rather than failing.
 *
 * The search starts at the repo's parent so it can never land on a "builds"
 * directory inside the repo itself, which isn't gitignored.
 */
export function findBuildsRoot(root = projectRoot) {
  let dir = dirname(root);
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = join(dir, "builds");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dirname(root), "builds");
}
