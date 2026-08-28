<script lang="ts">
  // The 6 dungeon-boss cells (tracker.cpp:798-828 upstream,
  // other_areas_layout row 0 cols 0-5). Each is a TrackerAreaCell reused
  // with a boss-portrait background that swaps to its "_dead" sprite once
  // that boss's heart-container location is checked. The upstream
  // "Required" checkbox row is deliberately not ported - required-boss state
  // still comes from a synced config.yaml (data.requiredBosses), it just
  // isn't user-togglable here.
  import { TRACKED_AREAS, REQUIRED_BOSS_OPTION_KEYS, BOSS_LOCATIONS } from "$lib/gameData";
  import { trackerBossImage } from "$lib/logic/tracker-images";
  import { isLocationMarked } from "$lib/logic/locations";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";
  import DungeonItemRow from "./DungeonItemRow.svelte";

  const bossAreas = TRACKED_AREAS.filter((area) => area.imageName in REQUIRED_BOSS_OPTION_KEYS);
</script>

<div class="tracking-boss-checklist" aria-label="Dungeon bosses">
  {#each bossAreas as area (area.name)}
    {@const bossName = area.imageName}
    {@const heartLocation = BOSS_LOCATIONS[bossName]}
    {@const dead = heartLocation ? isLocationMarked(heartLocation) : false}
    <div class="tracking-boss-entry">
      <DungeonItemRow dungeon={area.name} />
      <TrackerAreaCell areaName={area.name} targetKind="area" background={trackerBossImage(bossName, dead)} />
    </div>
  {/each}
</div>
