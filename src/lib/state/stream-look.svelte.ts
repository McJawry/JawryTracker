// How a browser source shows the tracker's row of dungeons and misc areas: the
// tracker's own location counts, and its dungeons' crosses and checks, sent
// along with the run in its display store (tauri/race-stream.ts). A browser
// source works out no logic of its own, so it can't tell what is accessible,
// nor which boss stands behind which dungeon. Null everywhere else - and in a
// browser source whose tracker sent none - for the row to work out itself.
import type { AreaCount } from "$lib/logic/locations";
import type { DungeonLook } from "$lib/logic/dead-locations";

export const streamLook: {
  areaCounts: Record<string, AreaCount> | null;
  dungeons: Record<string, DungeonLook> | null;
} = $state({ areaCounts: null, dungeons: null });
