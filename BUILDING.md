# Building JawryTracker

Every command below runs from the repo root (the folder holding
`package.json`). Markdown rather than `.txt` so it renders on GitHub.

---

## One-time setup

Needed once per machine:

- **Node.js** (v20+) — `node --version`
- **Rust toolchain** — `rustc --version`; install from <https://rustup.rs>
- **Visual Studio Build Tools** with the *Desktop development with C++* workload
  (Rust needs the MSVC linker on Windows)
- **WebView2 runtime** — preinstalled on Windows 11

Then install the JS dependencies:

```
npm install
```

---

## Daily commands

| Command | What it does |
|---|---|
| `npm run tauri dev` | Runs the app with hot reload. Frontend is served from `localhost:1420`. |
| `npm run check` | TypeScript + Svelte type check. Should report **0 errors**. |
| `npm run build:app` | Full release build, then copies the artifacts into `builds/`. |
| `npm run collect` | Re-copies artifacts from a build you already made. No compiling. |

### Notes on `tauri dev`

- Changes under `src/` hot-reload instantly.
- Changes to **`src-tauri/tauri.conf.json`, `Cargo.toml`, `capabilities/`, or
  any `.rs` file** do **not** hot-reload — stop the app and start it again.
- If startup fails with *"Port 1420 is already in use"*, an orphaned Vite
  process is still holding it. Find and kill it:

  ```
  Get-NetTCPConnection -LocalPort 1420 -State Listen | Select-Object OwningProcess
  ```

---

## Making a release build

**Stop `tauri dev` first** — Cargo locks the build directory, so a release
build will otherwise sit there waiting.

```
npm run build:app
```

No environment variables or signing keys are needed.

The **first** release build takes several minutes: Rust compiles the whole
dependency tree from scratch in release mode. Later builds are incremental and
much faster.

### What comes out

Artifacts are copied to `builds/v<version>/`, where `<version>` comes from
`package.json`. Bumping the version starts a new folder rather than
overwriting the last one.

`builds/` is found by walking up from the repo root until a folder named
`builds` turns up, so it can live beside the clone rather than inside it; if
there isn't one, it's created next to the repo. Only bundles stamped with the
version just built are copied — `target/release/bundle` keeps every installer
you have ever produced, and without that filter old versions get swept into
the new release folder.

| File | What it is |
|---|---|
| `JawryTracker.exe` | Standalone binary — **the one to distribute** |
| `JawryTracker_<version>_x64-setup.exe` | NSIS installer |
| `JawryTracker_<version>_x64_en-US.msi` | MSI installer, for managed installs |
| `build-info.json` | Version + timestamp, so an old folder is self-describing |

`builds/` sits deliberately *outside* the git repo, so compiled binaries
can never be accidentally committed.

### Why the standalone exe is the primary download

It is fully self-contained: the entire frontend (HTML, CSS, JS, and all 14 MB
of assets under `static/`) is compiled **into** the binary. There is no folder
of loose files to ship.

It also runs portable — see below — which the installers do not, since an
install into `Program Files` can't write beside itself. The installers are
built because `bundle.targets` is `"all"`; ship them only if someone
specifically wants a system install.

---

## Portable mode

The app keeps everything it writes in a **`data` folder beside the
executable**:

| Path | What |
|---|---|
| `data/layout.json` | Panel layout, sizes, window position (auto-saved) |
| `data/presets/*.json` | Named layout presets |
| `data/presets/colors/*.json` | Named colour presets |
| `data/webview/` | WebView2 profile — **all tracker progress**: checked locations, items, hints, notes, settings |

Copy the app folder anywhere and everything travels with it. Nothing is
written to AppData.

If the executable's folder isn't writable — an install into `Program Files`,
say — the app falls back to the normal AppData location rather than failing to
start. Settings shows which one is actually in use.

### Moving to a newer version

Copy the whole `data` folder from the old version into the new one **before
first launch**. That brings progress and preferences together.

For preferences only, Settings → Preference presets → **Import portable
preferences...** copies `layout.json` and every preset out of an older copy's
folder.

### Shared presets

Layout and colour presets each choose their own storage independently: the
portable app folder, or `Documents\JawryTracker`. The shared folder lets
several portable copies use one set of presets.

---

## Bumping the version

Edit `version` in **`package.json`**. That is the single source of truth:

- `src-tauri/tauri.conf.json` reads it (its `version` is the path
  `../package.json`)
- the version shown in the app's title bar reads it
- the GitHub release notice compares against it

Bump it **before** building a release. Two releases sharing a version means
the notice can't tell them apart.

`src-tauri/Cargo.toml` carries its own `version` for the Rust crate. It has no
effect on the app.

---

## Publishing a release

1. Bump `version` in `package.json` and run `npm run build:app`.
2. Create a GitHub release at
   <https://github.com/McJawry/JawryTracker/releases> tagged `v<version>`.
3. Upload the artifacts from `builds/v<version>/`.

Tag releases as `v<version>` matching `package.json` — that's what the
in-app notice compares against.

### The update notice

There is **no auto-update**. Windows can't replace a running `.exe`, which is
what Tauri's updater needs an installer for — incompatible with shipping
portable. The updater plugin, its Rust crates, its `tauri.conf.json` block and
its capabilities have all been removed, which is why builds need no
environment variables.

> A signing keypair from the abandoned updater setup is still sitting at
> `%USERPROFILE%\.tauri\jawrytracker.key`. Nothing reads it; it can be deleted
> unless auto-update is ever revived.

What remains is notification only: on launch the app reads
`https://api.github.com/repos/McJawry/JawryTracker/releases/latest` and, if
the tag is newer than the running version, shows a banner in the Control Panel
with a link to the release. Nothing downloads or installs. Being offline,
rate-limited, or having no releases published yet are all silent.

Users update by downloading the new exe and copying their `data` folder across.

Source: `src/lib/tauri/release-check.ts` and
`src/lib/components/layout/UpdateNotice.svelte`.

---

## What is and isn't in the repo

Committed: `src/`, `src-tauri/` (minus `target/`), `static/`, and the config
files. Ignored: `node_modules/`, `build/`, `.svelte-kit/`, and
`src-tauri/target/` — that last one reaches several GB.

`builds/` is outside the repo root entirely, so release artifacts are
never committed. Distribute them through GitHub Releases.

---

## Where user data lives

Not in the exe — created on first run, in the portable `data` folder beside
it (see **Portable mode** above). Only when that folder isn't writable does it
fall back to `%APPDATA%\com.mcjawry.wwrhinttracker\` and WebView2's default
store.

That fallback path comes from `identifier` in `tauri.conf.json`. Changing it
orphans the saved layout and progress of anyone running in fallback mode.
