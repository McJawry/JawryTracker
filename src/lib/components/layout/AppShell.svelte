<script lang="ts">
  // Dockable-section layout: every top-level section (control panel, main
  // tracker, summary, sphere board, notes, hint panel) is rendered generically
  // via DockableSection.svelte, in the order stored in layoutState.rows
  // ($lib/state/layout.svelte.ts) - drag a section's title bar to reorder,
  // resize its edge, dock/undock, or hide it (see DockableSection.svelte for
  // all of that behavior). This file just lays out the rows/columns.
  import DockableSection from "./DockableSection.svelte";
  import { layoutState } from "$lib/state/layout.svelte";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
</script>

<main class="app-shell">
  <!-- rows -> columns -> stacked sections; see state/layout.svelte.ts. The
       column level is what lets two panels share the space beside a wide
       Main Tracker. -->
  {#each layoutState.rows as row, rowIndex (rowIndex)}
    <div class="dockable-row">
      {#each row as column, columnIndex (columnIndex)}
        <div class="dockable-column">
          {#each column as sectionId (sectionId)}
            <DockableSection {sectionId} />
          {/each}
        </div>
      {/each}
    </div>
  {/each}

  <button
    class="tool-button show-chrome-button"
    type="button"
    onclick={() => { settings.chromeHidden = false; saveSettings(); }}
  >
    Show title/settings
  </button>
</main>

