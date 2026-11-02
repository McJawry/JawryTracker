<script lang="ts">
  // The 6 dungeon-boss cells (tracker.cpp:798-828 upstream,
  // other_areas_layout row 0 cols 0-5). Each is a TrackerAreaCell reused
  // with a boss-portrait background. The upstream "Required" checkbox row is
  // deliberately not ported - required-boss state still comes from a synced
  // config.yaml (data.requiredBosses), it just isn't user-togglable here.
  //
  // Each shows what race mode is known to ask of its dungeon, the way the race
  // stream's grid layout shows the bosses (RaceStreamGrid.svelte): a dungeon
  // left out is dimmed and crossed out, and a required one whose boss is
  // beaten is dimmed with a check. Only a required one gets the check: Clear
  // dead checks off the heart containers of dungeons it rules out, so any
  // other checked one may mean nothing was beaten - it's just dimmed, as done.
  // The boss is whichever stands behind the dungeon's boss door, which with
  // boss entrances shuffled is part of the dungeon (logic/dead-locations.ts).
  import { TRACKED_AREAS, REQUIRED_BOSS_OPTION_KEYS, BOSS_LOCATIONS } from "$lib/gameData";
  import { trackerBossImage } from "$lib/logic/tracker-images";
  import { isLocationMarked } from "$lib/logic/locations";
  import { getDungeonRequirements, type DungeonRequirement } from "$lib/logic/dead-locations";
  import TrackerAreaCell from "./TrackerAreaCell.svelte";
  import DungeonItemRow from "./DungeonItemRow.svelte";
  import AreaHintStrip from "./AreaHintStrip.svelte";

  const bossAreas = TRACKED_AREAS.filter((area) => area.imageName in REQUIRED_BOSS_OPTION_KEYS);

  const requirements = $derived.by((): Record<string, DungeonRequirement> => {
    try {
      return getDungeonRequirements();
    } catch {
      // Before the seed's logic has loaded, nothing is known about them.
      return {};
    }
  });

  function look(dungeon: string, vanillaBoss: string): { dimmed: boolean; mark: "cross" | "check" | null } {
    const known = requirements[dungeon];
    const boss = known ? known.boss : vanillaBoss;
    const beaten = Boolean(boss) && isLocationMarked(BOSS_LOCATIONS[boss] ?? "");
    if (known?.requirement === "unrequired") return { dimmed: true, mark: "cross" };
    if (beaten) return { dimmed: true, mark: known?.requirement === "required" ? "check" : null };
    return { dimmed: false, mark: null };
  }
</script>

<div class="tracking-boss-checklist" aria-label="Dungeon bosses">
  {#each bossAreas as area (area.name)}
    {@const shown = look(area.name, area.imageName)}
    <div class="tracking-boss-entry">
      <DungeonItemRow dungeon={area.name} />
      <AreaHintStrip areaName={area.name} />
      <TrackerAreaCell
        areaName={area.name}
        targetKind="area"
        background={trackerBossImage(area.imageName, false)}
        hintIconsOutside
        dimmed={shown.dimmed}
        mark={shown.mark}
      />
    </div>
  {/each}
</div>
