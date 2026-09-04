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
  import { markDocked, markUndocked, undockedState } from "$lib/state/undocked.svelte";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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

  // Every panel keeps a button here whether it is open or not, so the control
  // panel always shows the full set and one click closes what is open. An
  // undocked panel counts as open: it is visible, just in its own window.
  const isSectionOpen = (visibilityKey: keyof typeof settings.sectionVisibility) =>
    Boolean(settings.sectionVisibility[visibilityKey]);

  // The two places a panel can be, tracked independently: it can sit in the
  // layout, in its own window, in both at once, or in neither. Each button
  // reports and toggles only its own place, so opening one never disturbs the
  // other.
  const isDocked = (section: { id: string; visibilityKey: keyof typeof settings.sectionVisibility }) =>
    isSectionOpen(section.visibilityKey);
  const isUndocked = (section: { id: string; visibilityKey: keyof typeof settings.sectionVisibility }) =>
    undockedState.ids.includes(section.id);

  /** Closes a section's window if it has one. Safe when there is none. */
  async function closePopoutFor(sectionId: string) {
    const meta = SECTION_META[sectionId];
    if (!meta?.popout) return;
    markDocked(sectionId);
    try {
      const popout = await WebviewWindow.getByLabel(meta.popout.label);
      await popout?.close();
    } catch (error) {
      console.error(`Could not close the ${sectionId} popout`, error);
    }
  }

  /** Shows the panel in the layout. Leaves any window it has alone. */
  function dockSection(sectionId: string) {
    const meta = SECTION_META[sectionId];
    if (!meta?.visibilityKey) return;
    settings.sectionVisibility[meta.visibilityKey] = true;
    saveSettings();
  }

  /** Takes the panel out of the layout. Leaves any window it has alone. */
  function closeDockedSection(sectionId: string) {
    const meta = SECTION_META[sectionId];
    if (!meta?.visibilityKey) return;
    settings.sectionVisibility[meta.visibilityKey] = false;
    saveSettings();
  }

  /** Opens the panel's own window, whether or not it is also in the layout. */
  function undockSection(sectionId: string) {
    const meta = SECTION_META[sectionId];
    if (!meta?.popout) return;
    markUndocked(sectionId);
    void openPopoutForSection(sectionId);
  }
</script>

<header class="top-bar">
  <div class="top-bar-row">
    <!-- Start New Tracker sits with the title rather than on the row below,
         which leaves that row wide enough for every panel entry to fit on one
         line instead of wrapping onto a second. -->
    <div class="top-bar-identity">
      <div>
        <h1>JawryTracker</h1>
        <p>v{APP_VERSION}</p>
      </div>
      <button class="danger-button" type="button" onclick={startNewTracker}>Start New Tracker</button>
    </div>
    <div class="top-actions">
      <span>{ui.dataStatus}</span>
      <button class="tool-button" type="button" onclick={openSettingsPopout}>Settings</button>
      <button class="tool-button" type="button" onclick={hideChrome}>Hide title/settings</button>
    </div>
  </div>

  <div class="top-bar-row hidden-sections-row" aria-label="Panel layout">
    <span class="hidden-sections-label">Panels:</span>
    {#each HIDEABLE_SECTIONS as section (section.id)}
      {@const docked = isDocked(section)}
      {@const undocked = isUndocked(section)}
      <!-- Every panel keeps an entry, open or not. Collapsed to a name; hover
           or keyboard focus reveals the two choices, and whichever one is
           where the panel already is wears a cross and closes it. -->
      <span class="restore-section">
        <span class="restore-section-name">{section.title}</span>
        <span class="restore-section-options">
          <button
            class="tool-button section-toggle"
            class:open={docked}
            type="button"
            title={docked ? `Remove ${section.title} from the layout` : `Show ${section.title} in the layout`}
            onclick={() => (docked ? closeDockedSection(section.id) : dockSection(section.id))}
          >
            Dock
          </button>
          <button
            class="tool-button section-toggle"
            class:open={undocked}
            type="button"
            title={undocked ? `Close the ${section.title} window` : `Open ${section.title} in its own window`}
            onclick={() => (undocked ? closePopoutFor(section.id) : undockSection(section.id))}
          >
            Undock
          </button>
        </span>
      </span>
    {/each}
  </div>

  <UpdateNotice />
</header>
