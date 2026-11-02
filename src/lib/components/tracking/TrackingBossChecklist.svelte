<script lang="ts">
  // The 6 dungeon-boss cells (tracker.cpp:798-828 upstream,
  // other_areas_layout row 0 cols 0-5). Each is a TrackerAreaCell reused
  // with a boss-portrait background. The upstream "Required" checkbox row is
  // deliberately not ported - required-boss state still comes from a synced
  // config.yaml (data.requiredBosses), it just isn't user-togglable here.
  //
  // Each shows what race mode is known to ask of its dungeon, the way the race
  // stream's grid layout shows the bosses - see getDungeonLooks. A browser
  // source shows the tracker's own, sent along with the run: it works out no
  // logic itself, so it couldn't tell which boss is behind which dungeon.
  import { TRACKED_AREAS, REQUIRED_BOSS_OPTION_KEYS } from "$lib/gameData";
  import { trackerBossImage } from "$lib/logic/tracker-images";
  import { getDungeonLooks } from "$lib/logic/dead-locations";
  import { streamLook } from "$lib/state/stream-look.svelte";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";
  import DungeonItemRow from "./DungeonItemRow.svelte";
  import AreaHintStrip from "./AreaHintStrip.svelte";

  const bossAreas = TRACKED_AREAS.filter((area) => area.imageName in REQUIRED_BOSS_OPTION_KEYS);

  const looks = $derived(streamLook.dungeons ?? getDungeonLooks());
</script>

<div class="tracking-boss-checklist" aria-label="Dungeon bosses">
  {#each bossAreas as area (area.name)}
    {@const shown = looks[area.name]}
    <div class="tracking-boss-entry">
      <DungeonItemRow dungeon={area.name} />
      <AreaHintStrip areaName={area.name} />
      <TrackerAreaCell
        areaName={area.name}
        targetKind="area"
        background={trackerBossImage(area.imageName, false)}
        hintIconsOutside
        dimmed={shown?.dimmed ?? false}
        mark={shown?.mark ?? null}
      />
    </div>
  {/each}
</div>
