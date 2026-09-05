// Copies the artifacts `tauri build` just produced into APP/builds/v<version>/.
//
// Tauri has no after-build hook in tauri.conf.json, so this runs as the second
// half of `npm run build:app`. It only ever copies out of target/release - it
// never builds anything itself, so running it twice is harmless.
import { mkdir, readdir, copyFile, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(projectRoot, "src-tauri", "target", "release");
const bundleDir = join(releaseDir, "bundle");

const tauriConfig = JSON.parse(await readFile(join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const { productName } = tauriConfig;

// tauri.conf.json's "version" may be a literal semver or a path to a
// package.json to read it from - follow the path when that's what it is.
const version = /^\d/.test(tauriConfig.version)
  ? tauriConfig.version
  : JSON.parse(await readFile(resolve(projectRoot, "src-tauri", tauriConfig.version), "utf8")).version;

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
function findBuildsRoot(root) {
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

const outputDir = join(findBuildsRoot(projectRoot), `v${version}`);

if (!existsSync(releaseDir)) {
  console.error(`No release build found at ${releaseDir}\nRun "npm run tauri build" first.`);
  process.exit(1);
}

/**
 * Whether a bundle belongs to the version just built.
 *
 * `tauri build` never clears target/release/bundle, so every previous
 * version's installer is still sitting in there - and copying the folder
 * wholesale swept v0.1.0 and v0.1.1 into the v0.1.2 release folder. Bundle
 * names carry their version (JawryTracker_0.1.2_x64-setup.exe), so anything
 * stamped with a different one is a leftover from an earlier build.
 *
 * Names with no version stamp are kept: that's the standalone exe, which is
 * read straight out of target/release and so is always the current build.
 */
function isCurrentVersion(fileName) {
  const stamped = fileName.match(/[_-](\d+\.\d+\.\d+)[_-]/);
  return !stamped || stamped[1] === version;
}

/** Every bundled installer, plus the standalone exe. */
async function findArtifacts() {
  const artifacts = [];

  // Scanned rather than assumed: whether the standalone binary lands as
  // <productName>.exe or as the Cargo package name depends on the Tauri
  // version's mainBinaryName handling.
  for (const entry of await readdir(releaseDir)) {
    if (!entry.toLowerCase().endsWith(".exe")) continue;
    const path = join(releaseDir, entry);
    if ((await stat(path)).isFile()) artifacts.push(path);
  }

  if (existsSync(bundleDir)) {
    for (const kind of await readdir(bundleDir)) {
      const kindDir = join(bundleDir, kind);
      if (!(await stat(kindDir)).isDirectory()) continue;
      for (const entry of await readdir(kindDir)) {
        // .sig files accompany updater artifacts and must travel with them.
        if (/\.(exe|msi|zip|sig|app|dmg|deb|rpm|AppImage)$/i.test(entry) && isCurrentVersion(entry)) {
          artifacts.push(join(kindDir, entry));
        }
      }
    }
  }

  return artifacts;
}

const artifacts = await findArtifacts();
if (!artifacts.length) {
  console.error(`No artifacts found under ${releaseDir}. Did the build finish?`);
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

const copied = [];
for (const source of artifacts) {
  const name = source.split(/[\\/]/).pop();
  await copyFile(source, join(outputDir, name));
  const { size } = await stat(source);
  copied.push({ name, mb: (size / 1024 / 1024).toFixed(1) });
}

// A short manifest so an old build folder is self-describing later.
await writeFile(
  join(outputDir, "build-info.json"),
  `${JSON.stringify({ productName, version, builtAt: new Date().toISOString(), files: copied.map((f) => f.name) }, null, 2)}\n`
);

console.log(`\n${productName} v${version} -> ${outputDir}`);
copied.forEach(({ name, mb }) => console.log(`  ${name}  (${mb} MB)`));
