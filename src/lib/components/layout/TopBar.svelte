<script lang="ts">
  import { APP_VERSION } from "$lib/constants";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { ui, setMarkStartingMode } from "$lib/state/ui.svelte";
  import { checked, saveChecked } from "$lib/state/checked.svelte";
  import { sphere, resetSphereState } from "$lib/state/sphere.svelte";
  import { hints, hintNotes, saveHintNotes } from "$lib/state/hints.svelte";
  import { resetDungeonItemsState } from "$lib/state/dungeon-items.svelte";
  import { resetItemTrackerState } from "$lib/state/item-tracker.svelte";
  import { openPopoutWindow } from "$lib/tauri/popout-window";
  import { HIDEABLE_SECTIONS, SECTION_META } from "$lib/section-meta";
  import { markUndocked } from "$lib/state/undocked.svelte";
  import { openPopoutForSection } from "$lib/tauri/popout-geometry";
  import UpdateNotice from "./UpdateNotice.svelte";

  function openSettingsPopout() {
    void openPopoutWindow({
      label: "settings-popout",
      popoutParam: "settings",
      title: "JawryTracker - Settings",
      width: 420,
      height: 560,
      minWidth: 320,
      minHeight: 360
    });
  }

  function hideChrome() {
    settings.chromeHidden = true;
    saveSettings();
  }

  // Moved here from the (now removed) Summary panel section.
  function startNewTracker() {
    const shouldReset = confirm("Start a new tracker? This clears notes, checked locations, items, and sphere placements.");
    if (!shouldReset) return;

    hintNotes.value = "";
    saveHintNotes();
    hints.length = 0;
    Object.keys(checked).forEach((key) => delete checked[key]);
    saveChecked();
    resetSphereState();
    resetItemTrackerState();
    // Dungeon keys/maps/compasses are ownership too - the confirm above says
    // "items", and leaving them behind carried the last run's inventory into
    // the new one, where it kept feeding the sphere logic.
    resetDungeonItemsState();
    // A fresh run is exactly when the seed's starting items get entered, so
    // arm the mode rather than making the user find the button.
    setMarkStartingMode(true);
  }

  // A section is hidden from its own title bar's X button
  // (DockableSection.svelte), which removes that title bar from the layout -
  // so the only way back is from here.
  const hiddenSections = $derived(HIDEABLE_SECTIONS.filter((section) => !settings.sectionVisibility[section.visibilityKey]));

  // Restoring a hidden section splits into Dock/Undock so bringing one back
  // as its own window doesn't need a dock-then-undock round trip.
  function dockSection(sectionId: string) {
    const meta = SECTION_META[sectionId];
    if (!meta?.visibilityKey) return;
    settings.sectionVisibility[meta.visibilityKey] = true;
    saveSettings();
  }

  function undockSection(sectionId: string) {
    const meta = SECTION_META[sectionId];
    if (!meta?.visibilityKey) return;
    // Visible *and* undocked: a hidden section has no title bar to pop out
    // from, so its window is opened directly.
    settings.sectionVisibility[meta.visibilityKey] = true;
    saveSettings();
    markUndocked(sectionId);
    void openPopoutForSection(sectionId);
  }
</script>

<header class="top-bar">
  <div class="top-bar-row">
    <div>
      <h1>JawryTracker</h1>
      <p>v{APP_VERSION}</p>
    </div>
    <div class="top-actions">
      <span>{ui.dataStatus}</span>
      <button class="tool-button" type="button" onclick={openSettingsPopout}>Settings</button>
      <button class="tool-button" type="button" onclick={hideChrome}>Hide title/settings</button>
    </div>
  </div>

  <div class="top-bar-row hidden-sections-row" aria-label="Layout and run actions">
    <button class="danger-button" type="button" onclick={startNewTracker}>Start New Tracker</button>
    {#if hiddenSections.length}
      <span class="hidden-sections-label">Hidden:</span>
      {#each hiddenSections as section (section.id)}
        <!-- Collapsed to a name; hover or keyboard focus reveals the two
             restore choices. focus-within keeps it reachable by tab. -->
        <span class="restore-section">
          <span class="restore-section-name">{section.title}</span>
          <span class="restore-section-options">
            <button class="tool-button" type="button" onclick={() => dockSection(section.id)}>Dock</button>
            <button class="tool-button" type="button" onclick={() => undockSection(section.id)}>Undock</button>
          </span>
        </span>
      {/each}
    {:else}
      <span class="hidden-sections-label">All sections visible</span>
    {/if}
  </div>

  <UpdateNotice />
</header>
