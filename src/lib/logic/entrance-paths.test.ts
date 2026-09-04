import { beforeEach, describe, expect, it, vi } from "vitest";
import { WWRSphereEngine } from "$lib/logic";

/**
 * The world these tests walk is the situation that prompted the port: Earth
 * Temple entered from two different doors, one of which lands you past a lock.
 *
 *   Windfall Island --[shuffled]--> ET First Room --(locked)--> ET Mid Room
 *                                        |                          |
 *                                    (open)                     (open)
 *                                        v                          v
 *                                  ET Second Room           ET Boss Door Room
 *                                                                   ^
 *   Western Fairy Island --------------[shuffled]-------------------+
 *
 * So the boss door room has a fully walkable route from Western Fairy Island
 * and a route from Windfall that crosses a door you cannot yet open, while the
 * second room is only reachable from Windfall. The randomizer shows each check
 * its own best route, which is why one dungeon lists two different entrances.
 */
const normalize = WWRSphereEngine.normalize;

interface FakeArea {
  name: string;
  island?: string;
  dungeon?: string;
  hintRegion?: string;
  exits: Record<string, { name: string }>;
  locations: Array<{ name: string }>;
}

interface AreaSpec {
  island?: string;
  dungeon?: string;
  hintRegion?: string;
  exits?: string[];
  locations?: string[];
}

function area(name: string, spec: AreaSpec): FakeArea {
  return {
    name,
    island: spec.island,
    dungeon: spec.dungeon,
    hintRegion: spec.hintRegion,
    exits: Object.fromEntries((spec.exits ?? []).map((exit) => [normalize(exit), { name: exit }])),
    locations: (spec.locations ?? []).map((location) => ({ name: location }))
  };
}

/** Doors this seed shuffles, and where each currently leads. */
let connections: Record<string, string> = {};
/** Ordinary doors that cannot be opened with what is held. */
let locked: Set<string> = new Set();
let areas: Record<string, FakeArea> = {};

vi.mock("$lib/state/data.svelte", () => ({
  data: {
    get sphereWorld() {
      return currentWorld();
    },
    get sphereOptions() {
      return options;
    },
    get requiredBosses() {
      return configRequiredBosses;
    }
  }
}));

// What a synced config said, and which heart containers have been checked off.
let options: Record<string, unknown> = {};
let configRequiredBosses = new Set<string>();
let checkedLocations = new Set<string>();

vi.mock("$lib/logic/locations", () => ({
  isLocationMarked: (location: string) => checkedLocations.has(location)
}));

vi.mock("$lib/logic/entrances", () => ({
  getEntranceName: (parent: string, connected: string) => `${parent} -> ${connected}`,
  getEntranceDestinationForEdge: (edge: string) => connections[edge] ?? "",
  getShuffledEntrances: () => Object.keys(connections).map((name) => ({ name, parent: name.split(" -> ")[0] })),
  getEntrancesForArea: (sector: string) =>
    (sectorDoors[sector] ?? []).map((name) => {
      const [parent, connected] = name.split(" -> ");
      return { name, parent, connected, isReverse: false, type: "DOOR" };
    })
}));

vi.mock("$lib/logic/sphere-calculation", () => ({
  getOwnedInventory: () => [],
  // Rebuilt whenever the world or the locked doors change, so its identity
  // signals "the items moved" exactly as the real one does.
  getSphereTraversableExitSet: () => traversable,
  isSphereExitTraversable: (parent: string, connected: string) => !locked.has(`${parent} -> ${connected}`)
}));

vi.mock("$lib/state/sphere.svelte", () => ({
  sphere: {
    get entranceConnections() {
      return connections;
    },
    get highlightedSectors() {
      return marks;
    },
    entranceMappings: {}
  }
}));

/** What each sector's entrance list shows, and which sectors are marked. */
let sectorDoors: Record<string, string[]> = {};
let marks: string[] = [];

let traversable = new Set<string>();

function currentWorld() {
  return { areas, shuffleEntrances: bossEntries };
}

// Only the shape getBossBehindSector reads: BOSS entries name the arenas.
const bossEntries = ["Jalhalla", "Molgera", "Gohma"].map((boss) => ({
  type: "BOSS",
  forward: { parent: `${boss} Boss Door Room`, connected: `${boss} Battle Arena` }
}));

const {
  canOpenSectorDoor,
  getDefeatedBossEvents,
  getMarkedRequiredBosses,
  getRequiredBossOptions,
  clearEntrancePathCache,
  findEntrancePaths,
  getBossBehindSector,
  getEntranceSourcePath,
  getLocationEntrancePath,
  getRequiredBossDoors,
  isBetterThan,
  Logicality
} = await import("./entrance-paths");
type LogicalityValue = (typeof Logicality)[keyof typeof Logicality];

function setWorld(list: FakeArea[]) {
  areas = Object.fromEntries(list.map((entry) => [normalize(entry.name), entry]));
  traversable = new Set(
    list.flatMap((entry) =>
      Object.values(entry.exits)
        .map((exit) => `${entry.name} -> ${exit.name}`)
        .filter((edge) => !locked.has(edge))
        .map(normalize)
    )
  );
  clearEntrancePathCache();
}

const WINDFALL_DOOR = "Windfall Island -> Windfall Jail";
const FAIRY_DOOR = "Western Fairy Island -> Western Fairy Island Past Flames";

function setupEarthTemple() {
  connections = {
    [WINDFALL_DOOR]: "ET First Room",
    [FAIRY_DOOR]: "ET Boss Door Room"
  };
  locked = new Set(["ET First Room -> ET Mid Room"]);
  setWorld([
    area("Windfall Island", { island: "Windfall Island", exits: ["Windfall Jail"] }),
    area("Western Fairy Island", {
      island: "Western Fairy Island",
      exits: ["Western Fairy Island Past Flames"]
    }),
    area("ET First Room", {
      dungeon: "Earth Temple",
      exits: ["ET Mid Room", "ET Second Room"],
      locations: ["Earth Temple - First Chest"]
    }),
    area("ET Second Room", { dungeon: "Earth Temple", locations: ["Earth Temple - Second Chest"] }),
    area("ET Mid Room", { dungeon: "Earth Temple", exits: ["ET Boss Door Room"] }),
    area("ET Boss Door Room", {
      dungeon: "Earth Temple",
      exits: ["ET Mid Room"],
      locations: ["Earth Temple - Boss Door Chest"]
    })
  ]);
}

beforeEach(() => {
  connections = {};
  locked = new Set();
  sectorDoors = {};
  marks = [];
  options = {};
  configRequiredBosses = new Set();
  checkedLocations = new Set();
  setWorld([]);
});

describe("isBetterThan", () => {
  const path = (list: string[], logicality: LogicalityValue = Logicality.Full, startRegion = "") => ({
    list,
    logicality,
    startRegion
  });

  it("prefers the more logical route however long it is", () => {
    const long = path(["a", "b", "c"], Logicality.Full);
    const short = path(["a"], Logicality.Partial);
    expect(isBetterThan(long, short)).toBe(true);
    expect(isBetterThan(short, long)).toBe(false);
  });

  it("beats nothing at all, but not standing in the room already", () => {
    const some = path(["a"]);
    expect(isBetterThan(some, path([], Logicality.None))).toBe(true);
    // An empty list that is fully logical means you are already there.
    expect(isBetterThan(some, path([], Logicality.Full))).toBe(false);
  });

  it("prefers a route starting in the list you are reading", () => {
    const here = path(["a", "b"], Logicality.Full, "Earth Temple");
    const elsewhere = path(["c"], Logicality.Full, "Windfall Island");
    expect(isBetterThan(here, elsewhere, "Earth Temple")).toBe(true);
    // ...and that beats being shorter.
    expect(isBetterThan(elsewhere, here, "Earth Temple")).toBe(false);
  });

  it("falls back to fewer doors when neither starts where you are", () => {
    const shorter = path(["a"], Logicality.Full, "Windfall Island");
    const longer = path(["a", "b"], Logicality.Full, "Outset Island");
    expect(isBetterThan(shorter, longer, "Earth Temple")).toBe(true);
    expect(isBetterThan(longer, shorter, "Earth Temple")).toBe(false);
  });
});

describe("findEntrancePaths", () => {
  it("reaches rooms behind a shuffled door and counts the door", () => {
    setupEarthTemple();
    const paths = findEntrancePaths("Windfall Island");
    expect(paths.get(normalize("ET First Room"))).toMatchObject({
      list: [WINDFALL_DOOR],
      logicality: Logicality.Full
    });
  });

  it("marks a route partial when an ordinary door past the entrance is shut", () => {
    setupEarthTemple();
    const paths = findEntrancePaths("Windfall Island");
    // Both rooms sit behind the locked door, so neither is fully walkable.
    expect(paths.get(normalize("ET Mid Room"))?.logicality).toBe(Logicality.Partial);
    expect(paths.get(normalize("ET Boss Door Room"))?.logicality).toBe(Logicality.Partial);
    // The room reached without crossing it is untouched.
    expect(paths.get(normalize("ET Second Room"))?.logicality).toBe(Logicality.Full);
  });

  it("stops at another island rather than routing through the sea", () => {
    connections = { "Windfall Island -> Windfall Jail": "Outset Island" };
    setWorld([
      area("Windfall Island", { island: "Windfall Island", exits: ["Windfall Jail"] }),
      area("Outset Island", {
        island: "Outset Island",
        exits: ["Outset Link's House"],
        locations: ["Outset Island - Underneath The Floor"]
      }),
      area("Outset Link's House", { island: "Outset Island" })
    ]);
    const paths = findEntrancePaths("Windfall Island");
    expect(paths.has(normalize("Outset Island"))).toBe(false);
    expect(paths.has(normalize("Outset Link's House"))).toBe(false);
  });

  it("lists every door on a route that crosses two shuffled entrances", () => {
    connections = {
      "Windfall Island -> Windfall Jail": "ET First Room",
      "ET First Room -> ET Mid Room": "DRC Compound"
    };
    setWorld([
      area("Windfall Island", { island: "Windfall Island", exits: ["Windfall Jail"] }),
      area("ET First Room", { dungeon: "Earth Temple", exits: ["ET Mid Room"] }),
      area("DRC Compound", { dungeon: "Dragon Roost Cavern", locations: ["DRC - Alcove With Water Jugs"] })
    ]);
    expect(findEntrancePaths("Windfall Island").get(normalize("DRC Compound"))).toMatchObject({
      list: ["Windfall Island -> Windfall Jail", "ET First Room -> ET Mid Room"],
      logicality: Logicality.Full,
      startRegion: "Windfall Island"
    });
  });

  it("gives up on a shuffled door that has not been recorded yet", () => {
    connections = { "Windfall Island -> Windfall Jail": "" };
    setWorld([
      area("Windfall Island", { island: "Windfall Island", exits: ["Windfall Jail"] }),
      area("Windfall Jail", { island: "Windfall Island" })
    ]);
    expect(findEntrancePaths("Windfall Island").has(normalize("Windfall Jail"))).toBe(false);
  });
});

describe("getLocationEntrancePath", () => {
  it("shows two checks in one dungeon their own best door", () => {
    setupEarthTemple();
    // Fully walkable from the fairy fountain side; only partly from Windfall.
    expect(getLocationEntrancePath("Earth Temple - Boss Door Chest")).toEqual([FAIRY_DOOR]);
    // Unreachable from the fairy side at all, so Windfall is the only answer.
    expect(getLocationEntrancePath("Earth Temple - Second Chest")).toEqual([WINDFALL_DOOR]);
  });

  it("prefers the door you came in by when reading that entrance list", () => {
    connections = {
      [WINDFALL_DOOR]: "ET First Room",
      "Outset Island -> Outset Link's House": "ET First Room"
    };
    setWorld([
      area("Windfall Island", { island: "Windfall Island", exits: ["Windfall Jail"] }),
      area("Outset Island", { island: "Outset Island", exits: ["Outset Link's House"] }),
      area("ET First Room", { dungeon: "Earth Temple", locations: ["Earth Temple - First Chest"] })
    ]);
    // Both routes are one fully logical door, so the open list breaks the tie.
    expect(getLocationEntrancePath("Earth Temple - First Chest", "Outset Island")).toEqual([
      "Outset Island -> Outset Link's House"
    ]);
    expect(getLocationEntrancePath("Earth Temple - First Chest", "Windfall Island")).toEqual([WINDFALL_DOOR]);
  });

  it("says nothing for a location no shuffled door leads to", () => {
    setupEarthTemple();
    expect(getLocationEntrancePath("Windfall Island - Maggie Delivery Reward")).toEqual([]);
  });
});

describe("getEntranceSourcePath", () => {
  it("describes the way to the area the door stands in", () => {
    setupEarthTemple();
    expect(getEntranceSourcePath("ET Boss Door Room -> ET Mid Room")).toEqual([FAIRY_DOOR]);
  });

  it("is empty for a door you are already standing at", () => {
    setupEarthTemple();
    expect(getEntranceSourcePath(WINDFALL_DOOR)).toEqual([]);
  });
});

/**
 * A sector is marked because a required boss is behind a door there, so what
 * settles the mark is the boss - not the dungeon. The two coincide only while
 * bosses stay in their own dungeons, which is why this went unnoticed on a
 * dungeon-entrances-only seed.
 */
describe("marked sectors", () => {
  function setupMarkedSector({ bossDoorShuffled = false } = {}) {
    marks = ["Windfall Island"];
    sectorDoors = { "Windfall Island": [WINDFALL_DOOR] };
    connections = { [WINDFALL_DOOR]: "ET First Room" };
    // An entry with no destination is a shuffled door not yet recorded.
    if (bossDoorShuffled) connections["ET Boss Door Room -> Jalhalla Battle Arena"] = "";
    setWorld([
      area("Windfall Island", { island: "Windfall Island", exits: ["Windfall Jail"] }),
      area("ET First Room", { dungeon: "Earth Temple", exits: ["ET Boss Door Room"] }),
      area("ET Boss Door Room", { dungeon: "Earth Temple", exits: ["Jalhalla Battle Arena"] }),
      area("Jalhalla Battle Arena", { dungeon: "Earth Temple" })
    ]);
  }

  it("finds the boss when it is still inside the dungeon behind the door", () => {
    setupMarkedSector();
    expect(getBossBehindSector("Windfall Island")).toBe("Jalhalla Battle Arena");
    expect(getRequiredBossDoors()).toEqual([{ parent: "Windfall Island", connected: "Windfall Jail" }]);
  });

  it("does not call a dungeon behind the door a boss", () => {
    setupMarkedSector({ bossDoorShuffled: true });
    // The dungeon is right there, but its boss door leads somewhere unknown.
    expect(getBossBehindSector("Windfall Island")).toBe("");
  });

  it("follows a recorded boss door on to the arena", () => {
    setupMarkedSector({ bossDoorShuffled: true });
    connections["ET Boss Door Room -> Jalhalla Battle Arena"] = "Jalhalla Battle Arena";
    clearEntrancePathCache();
    expect(getBossBehindSector("Windfall Island")).toBe("Jalhalla Battle Arena");
    expect(getRequiredBossDoors()).toEqual([
      { parent: "Windfall Island", connected: "Windfall Jail" },
      { parent: "ET Boss Door Room", connected: "Jalhalla Battle Arena" }
    ]);
  });

  it("requires the sector's door while it is the only one it could be", () => {
    setupMarkedSector({ bossDoorShuffled: true });
    expect(getRequiredBossDoors()).toEqual([{ parent: "Windfall Island", connected: "Windfall Jail" }]);
  });

  it("requires nothing while any of several doors could be the one", () => {
    setupMarkedSector({ bossDoorShuffled: true });
    sectorDoors["Windfall Island"] = [WINDFALL_DOOR, "Windfall Island -> Windfall Cafe Bar"];
    clearEntrancePathCache();
    // Twelve doors on Windfall and no way to tell which hides the boss: calling
    // all of them required would call items required that nothing needs.
    expect(getRequiredBossDoors()).toEqual([]);
  });
});

/**
 * The marker spins to say "the way in is open". It is only open when nothing
 * on the sector is still shut - the boss could be behind any door not yet
 * recorded, including the one you cannot get through.
 */
describe("a marked sector's marker", () => {
  const JAIL = "Windfall Island -> Windfall Jail";
  const LENZO = "Windfall Island -> Windfall Lenzo's House Upper";

  function setupMarker(shut: string[] = []) {
    marks = ["Windfall Island"];
    sectorDoors = { "Windfall Island": [JAIL, LENZO] };
    connections = {};
    locked = new Set(shut);
    setWorld([
      area("Windfall Island", {
        island: "Windfall Island",
        exits: ["Windfall Jail", "Windfall Lenzo's House Upper"]
      }),
      area("Windfall Jail", { locations: ["Windfall Island - Windfall Jail Maze Chest"] }),
      area("Windfall Lenzo's House Upper", { locations: ["Windfall Island - Lenzo House Left Chest"] })
    ]);
  }

  it("spins when every door that could hide the boss is open", () => {
    setupMarker();
    expect(canOpenSectorDoor("Windfall Island")).toBe(true);
  });

  it("stays still while one of them is shut", () => {
    // Lenzo's upper door wants the Picto Box, and the boss may be behind it.
    setupMarker([LENZO]);
    expect(canOpenSectorDoor("Windfall Island")).toBe(false);
  });

  it("stays still once every door is recorded, with nothing left to open", () => {
    setupMarker();
    connections[JAIL] = "Windfall Jail";
    connections[LENZO] = "Windfall Lenzo's House Upper";
    clearEntrancePathCache();
    expect(canOpenSectorDoor("Windfall Island")).toBe(false);
  });
});

/**
 * Race Mode picks a few dungeons and only their bosses have to fall, but the
 * config a racer generates does not say which - that is the thing being raced
 * for. The marks are where the player writes down what the hints told them,
 * so the tracker reads which bosses are required off the sectors they marked.
 */
describe("which bosses the run has to beat", () => {
  const DOOR = (sector: string) => `${sector} -> ${sector} Cave`;

  /** One marked sector per boss, each door already walked to its arena. */
  function setupMarks(bosses: Array<string | null>) {
    const sectors = bosses.map((_, index) => `Marked Island ${index + 1}`);
    marks = [...sectors];
    sectorDoors = Object.fromEntries(sectors.map((sector) => [sector, [DOOR(sector)]]));
    connections = Object.fromEntries(
      sectors.map((sector, index) => {
        const boss = bosses[index];
        // A mark whose door has not been walked yet names no boss.
        return [DOOR(sector), boss ? `${boss} Battle Arena` : ""];
      })
    );
    setWorld([
      ...sectors.map((sector) => area(sector, { island: sector, exits: [`${sector} Cave`] })),
      ...bosses.filter(Boolean).map((boss) => area(`${boss!} Battle Arena`, {}))
    ]);
    options = { progression_dungeons: "Race Mode", num_required_dungeons: bosses.length };
  }

  it("requires exactly the bosses the marks name", () => {
    setupMarks(["Jalhalla", "Molgera", "Gohma"]);
    expect(getMarkedRequiredBosses()).toEqual({ bosses: ["Jalhalla", "Molgera", "Gohma"], unresolved: 0 });
    expect(getRequiredBossOptions()).toEqual({
      Gohma_Required: true,
      Jalhalla_Required: true,
      Molgera_Required: true,
      Kalle_Demos_Required: false,
      Gohdan_Required: false,
      Helmaroc_King_Required: false
    });
  });

  it("narrows nothing while a mark has not given up its boss", () => {
    setupMarks(["Jalhalla", "Molgera", null]);
    expect(getMarkedRequiredBosses()).toEqual({ bosses: ["Jalhalla", "Molgera"], unresolved: 1 });
    // Any of the four could be behind that door, so all six stay required.
    expect(getRequiredBossOptions()).toEqual({});
  });

  it("narrows nothing while there are fewer marks than required dungeons", () => {
    setupMarks(["Jalhalla", "Molgera"]);
    options.num_required_dungeons = 3;
    expect(getRequiredBossOptions()).toEqual({});
  });

  it("leaves a config that lists them alone", () => {
    setupMarks(["Jalhalla", "Molgera", "Gohma"]);
    configRequiredBosses = new Set([normalize("Gohdan")]);
    expect(getRequiredBossOptions()).toEqual({});
  });

  it("narrows nothing outside Race Mode, where every boss is required", () => {
    setupMarks(["Jalhalla", "Molgera", "Gohma"]);
    options.progression_dungeons = "Enabled";
    expect(getRequiredBossOptions()).toEqual({});
  });
});

/**
 * The tracker learns a boss is down from its heart container being checked -
 * the player's own account of the fight, and with decoupled entrances the only
 * one available, since the arena may sit behind a door nobody recorded from
 * this side.
 */
describe("which bosses are down", () => {
  it("names the bosses whose heart container is checked", () => {
    checkedLocations = new Set([
      "Earth Temple - Jalhalla Heart Container",
      "Forsaken Fortress - Helmaroc King Heart Container"
    ]);
    expect(getDefeatedBossEvents()).toEqual(["Helmaroc King Defeated", "Jalhalla Defeated"]);
  });

  it("names none while every heart container is unchecked", () => {
    expect(getDefeatedBossEvents()).toEqual([]);
  });
});
