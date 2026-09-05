<script lang="ts">
  // Ported from the parsed-section markup in index.html plus renderHints()
  // (dev/app/app.js:1990+). Its own resize handle is gone now - Hint Panel
  // is a normal DockableSection like every other section, which provides a
  // generic right-edge resize handle (see DockableSection.svelte).
  import { hints, filter, historyButtons, undoNotes, redoNotes, type HintFilter } from "$lib/state/hints.svelte";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import HintCard from "./HintCard.svelte";

  const filterTabs: Array<{ value: HintFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "path", label: "Path" },
    { value: "item", label: "Items" },
    { value: "location", label: "Locations" },
    { value: "needs-review", label: "Review" }
  ];

  const visibleHints = $derived(
    hints.filter((hint) => {
      if (filter.value === "all") return true;
      if (filter.value === "needs-review") return hint.needsReview || hint.type === "needs-review";
      return hint.type === filter.value;
    })
  );
</script>

<aside class="hint-panel" aria-label="Parsed hint overview">
  <section class="parsed-section">
    <!-- No "Parsed Hints" heading: the section's own title bar already says
         Hint Panel, docked or undocked, so it only cost a line and pushed the
         controls down. They sit directly under that title bar instead, and
         they used to share a line with it and wrap into two or three rows of
         mostly empty space. -->
    <div class="parsed-actions">
      <!-- Lives here rather than in Settings: it's a per-view toggle you
           reach for while reading hints, not a configuration choice. -->
      <label class="filters-toggle" title="Show or hide the hint type filter buttons">
        <input
          type="checkbox"
          checked={settings.parsedHintsFilters}
          onchange={() => { settings.parsedHintsFilters = !settings.parsedHintsFilters; saveSettings(); }}
        />
        <span>Filters</span>
      </label>
      <button class="tool-button" type="button" disabled={historyButtons.undoDisabled} onclick={undoNotes}>Undo</button>
      <button class="tool-button" type="button" disabled={historyButtons.redoDisabled} onclick={redoNotes}>Redo</button>
      <span class="parsed-count">{hints.length} {hints.length === 1 ? "hint" : "hints"}</span>
    </div>
    <div class="tabs" role="tablist" aria-label="Hint type filters">
      {#each filterTabs as tab (tab.value)}
        <button class="tab" class:active={filter.value === tab.value} type="button" onclick={() => (filter.value = tab.value)}>
          {tab.label}
        </button>
      {/each}
    </div>
    <div class="hint-list" aria-live="polite">
      {#if !visibleHints.length}
        <div class="empty-state">
          {hints.length ? "No hints match this filter." : "Type hint notes to see them parsed here. Right-click a parsed hint to delete its note line."}
        </div>
      {:else}
        {#each visibleHints as hint (hint.lineNumber)}
          <HintCard {hint} />
        {/each}
      {/if}
    </div>
  </section>
</aside>
