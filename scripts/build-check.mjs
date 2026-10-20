// Says whether package.json's version still needs a build, for
// "Build JawryTracker Release.bat" beside the dev start/stop scripts.
//
// "Latest" is the build made most recently - by the time build-info.json
// records - not the highest number, so a test version built after a release
// counts as the latest one.
//
// Exit codes, for the batch file:
//   0   build it: no build has this version
//   10  skip: this version is the latest build
//   11  ask: this version was built before, but something else was built since
//   1   something went wrong reading the version or the builds
//
// Usage: node scripts/build-check.mjs [version]   (defaults to package.json's)
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { findBuildsRoot, readAppVersion } from "./build-paths.mjs";

const BUILD = 0;
const UP_TO_DATE = 10;
const BUILT_BEFORE = 11;

/** Every build folder with its version and when it was made. */
async function listBuilds(buildsRoot) {
  if (!existsSync(buildsRoot)) return [];
  const builds = [];
  for (const entry of await readdir(buildsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("v")) continue;
    const folder = join(buildsRoot, entry.name);
    let info = {};
    try {
      info = JSON.parse(await readFile(join(folder, "build-info.json"), "utf8"));
    } catch {
      // A folder without a manifest still counts; its own date stands in.
    }
    const builtAt = Date.parse(info.builtAt) || (await stat(folder)).mtimeMs;
    builds.push({ version: info.version || entry.name.slice(1), folder, builtAt });
  }
  return builds.sort((first, second) => second.builtAt - first.builtAt);
}

const day = (time) => new Date(time).toLocaleString();

try {
  const version = process.argv[2] || (await readAppVersion());
  const buildsRoot = findBuildsRoot();
  const builds = await listBuilds(buildsRoot);
  const latest = builds[0];
  const previous = builds.find((build) => build.version === version);

  if (!latest) {
    console.log(`No builds yet in ${buildsRoot} - building v${version}.`);
    process.exit(BUILD);
  }
  if (latest.version === version) {
    console.log(`v${version} is already the latest build (${day(latest.builtAt)}):`);
    console.log(`  ${latest.folder}`);
    console.log(`Change the version in package.json to make a new one.`);
    process.exit(UP_TO_DATE);
  }
  if (previous) {
    console.log(`v${version} was built before (${day(previous.builtAt)}), but the latest build is v${latest.version}.`);
    console.log(`Building it again replaces the files in:`);
    console.log(`  ${previous.folder}`);
    process.exit(BUILT_BEFORE);
  }
  console.log(`New version: v${version} (latest build is v${latest.version}, ${day(latest.builtAt)}).`);
  process.exit(BUILD);
} catch (error) {
  console.error(`Could not check the builds: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
