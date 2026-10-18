// `npm run build:app`: the release build, then collect-build.mjs.
//
// A wrapper rather than a bare `tauri build` so test versions can be built.
// Tauri wants a semver version, where letters are only allowed after a dash
// (0.2.7-beta.1, not 0.2.7b) - and the MSI installer goes further and accepts
// digits only even there, because Windows Installer stores versions as
// numbers. With `bundle.targets` set to "all", a lettered version therefore
// failed the whole build at the MSI step. Here the MSI is simply left out for
// such a version: the standalone exe and the NSIS installer both take it.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { projectRoot, readAppVersion } from "./build-paths.mjs";

const version = await readAppVersion();

// semver.org's grammar, less leading-zero checks the CLI makes itself.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const match = SEMVER.exec(version);
if (!match) {
  console.error(
    `package.json version "${version}" is not one Tauri accepts.\n` +
      `Letters go after a dash: "0.2.7-beta.1", "0.2.7-test.2", "0.2.7-rc.1".`
  );
  process.exit(1);
}

const [, , , , preRelease = "", buildMetadata = ""] = match;
// Each part numeric and no more than 65535 - what Windows Installer can store.
const msiCompatible = (part) => !part || /^\d+$/.test(part) && Number(part) <= 65535;
const skipMsi = !msiCompatible(preRelease) || !msiCompatible(buildMetadata);

const args = ["tauri", "build"];
if (skipMsi) {
  args.push("--bundles", "nsis");
  console.log(`v${version} is a test version: building the exe and the NSIS installer, no MSI.\n`);
}

const run = (command, commandArgs) => {
  // shell: true so npx resolves to npx.cmd on Windows.
  const result = spawnSync(command, commandArgs, { cwd: projectRoot, stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("npx", args);
run("node", [join("scripts", "collect-build.mjs")]);
