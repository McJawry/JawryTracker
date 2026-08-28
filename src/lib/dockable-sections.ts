// Pairs each dockable section's metadata ($lib/section-meta.ts) with the
// component that renders it. Kept separate from the metadata so components
// like TopBar.svelte can read section titles/visibility keys without
// importing this module (which imports TopBar itself).
import type { Component } from "svelte";
import TopBar from "$lib/components/layout/TopBar.svelte";
import MainTrackerSection from "$lib/components/tracking/MainTrackerSection.svelte";
import SphereBoard from "$lib/components/sphere/SphereBoard.svelte";
import NotesSection from "$lib/components/hints/NotesSection.svelte";
import HintPanel from "$lib/components/hints/HintPanel.svelte";
import { SECTION_META, type SectionMeta } from "$lib/section-meta";

export type { PopoutConfig, SectionMeta } from "$lib/section-meta";

export interface DockableSectionDef extends SectionMeta {
  component: Component;
}

const SECTION_COMPONENTS: Record<string, Component> = {
  "control-panel": TopBar,
  "main-tracker": MainTrackerSection,
  "sphere-board": SphereBoard,
  notes: NotesSection,
  "hint-panel": HintPanel
};

export const DOCKABLE_SECTIONS: Record<string, DockableSectionDef> = Object.fromEntries(
  Object.entries(SECTION_META).map(([id, meta]) => [id, { ...meta, component: SECTION_COMPONENTS[id] }])
);
