// How a browser source shows the tracker's row of dungeons and misc areas: the
// tracker's own location counts, and its dungeons' crosses and checks, sent
// along with the run in its display store (tauri/race-stream.ts). A browser
// source works out no logic of its own, so it can't tell what is accessible,
// nor which boss stands behind which dungeon. Null everywhere else - and in a
// browser source whose tracker sent none - for the row to work out itself.
//
// A race's browser source goes by what the host's tracker knows of each
// dungeon instead: every runner's run between them, and the host's
// corrections, as they all race the same seed. A runner's own run often has
// none of the hints or marks that tell. Only whether this runner has beaten a
// boss comes from their run.
import type { AreaCount } from "$lib/logic/locations";
import type { DungeonLook, DungeonRequirement } from "$lib/logic/dead-locations";

export const streamLook: {
  areaCounts: Record<string, AreaCount> | null;
  dungeons: Record<string, DungeonLook> | null;
  raceDungeons: Record<string, DungeonRequirement> | null;
} = $state({ areaCounts: null, dungeons: null, raceDungeons: null });
