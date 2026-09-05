<script lang="ts">
  // The misc trackers row (Mailbox/Great Sea/Hyrule/Ganon's Tower) - the
  // TRACKED_AREAS entries that aren't one of the 6 togglable dungeon bosses
  // (tracker.cpp:798-828 upstream, other_areas_layout row 0 cols 6-9). Reuses
  // TrackerAreaCell exactly like the boss row and sea sectors.
  import { TRACKED_AREAS, REQUIRED_BOSS_OPTION_KEYS } from "$lib/gameData";
  import { trackerBossImage, trackerMiscImage } from "$lib/logic/tracker-images";
  import { isLocationMarked } from "$lib/logic/locations";
  import { BOSS_LOCATIONS } from "$lib/gameData";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";

  const miscAreas = TRACKED_AREAS.filter((area) => !(area.imageName in REQUIRED_BOSS_OPTION_KEYS));

  function backgroundFor(area: (typeof miscAreas)[number]): string {
    if (area.imageKind !== "boss") return trackerMiscImage(area.imageName);
    const heartLocation = BOSS_LOCATIONS[area.imageName];
    const dead = heartLocation ? isLocationMarked(heartLocation) : false;
    return trackerBossImage(area.imageName, dead);
  }
</script>

<div class="tracking-misc-trackers" aria-label="Misc trackers">
  {#each miscAreas as area (area.name)}
    <TrackerAreaCell areaName={area.name} targetKind="area" background={backgroundFor(area)} />
  {/each}
</div>
