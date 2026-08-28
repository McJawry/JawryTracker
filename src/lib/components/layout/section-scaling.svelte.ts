// Shared scaling maths for a dockable section's content, so a popped-out
// section renders at exactly the same scale/width as it does docked (the
// popout shells and DockableSection both read these).
import { settings } from "$lib/state/settings.svelte";
import { SECTION_META } from "$lib/section-meta";

/** Logical (pre-zoom) content width - stretched horizontally for Hint Panel/Notes. */
export function getSectionLogicalWidth(sectionId: string): number {
  const meta = SECTION_META[sectionId];
  if (!meta) return 0;
  if (meta.horizontallyResizable) return settings.sectionWidths[sectionId] ?? meta.defaultWidth;
  return meta.defaultWidth;
}

/** Uniform zoom factor: how big the section is versus its design size. */
export function getSectionScale(sectionId: string): number {
  const meta = SECTION_META[sectionId];
  if (!meta) return 1;
  const scaledWidth = settings.sectionSizes[sectionId] ?? meta.defaultWidth;
  return scaledWidth / meta.defaultWidth;
}

/** Inline style for the content wrapper - identical docked and undocked. */
export function getSectionContentStyle(sectionId: string): string {
  const meta = SECTION_META[sectionId];
  if (!meta) return "";
  if (meta.fillContent) return `zoom: ${getSectionScale(sectionId)}`;
  // max-content lets the section hug its own contents rather than pinning
  // them to a width they then have to fit inside.
  if (meta.autoWidth) return `width: max-content; zoom: ${getSectionScale(sectionId)}`;
  return `width: ${getSectionLogicalWidth(sectionId)}px; zoom: ${getSectionScale(sectionId)}`;
}
