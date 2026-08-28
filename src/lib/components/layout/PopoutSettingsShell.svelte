<script lang="ts">
  // Settings can no longer live fixed inline in the control panel - they pop
  // out into their own window instead (same get-or-focus WebviewWindow
  // pattern as the sphere popout, see $lib/tauri/popout-window.ts). No
  // reference-data loading needed here since settings are pure localStorage
  // state, already kept in sync live across windows by storage-sync.ts.
  import SettingsPanel from "./SettingsPanel.svelte";
</script>

<main class="popout-settings-shell">
  <header class="popout-header">
    <h1>Settings</h1>
  </header>
  <SettingsPanel />
</main>

<style>
  /* Scoped to .popout-window (set on <body> by +layout.svelte) because
     Svelte injects :global rules into the document whether or not this
     component is rendered - an unscoped `html, body` here also repainted
     the MAIN window, overriding the page-background setting. */
  :global(html),
  :global(body.popout-window) {
    width: 100%;
    height: 100%;
    margin: 0;
    min-width: 0;
    overflow: auto;
    background: var(--panel);
  }

  /* align-items: flex-start keeps the fixed-width settings block at its own
     size instead of stretching it to the window - resizing then only changes
     how much empty space or scrollbar there is, never the layout itself. */
  .popout-settings-shell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    height: 100%;
    padding-bottom: 10px;
  }

  .popout-header {
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
  }

  .popout-header h1 {
    margin: 0;
    font-size: 0.9rem;
  }
</style>
