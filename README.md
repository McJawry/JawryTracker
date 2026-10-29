# JawryTracker

A Wind Waker HD Randomizer tracker with an expanded featureset.

JawryTracker is a desktop tracker for the
[Wind Waker HD Randomizer](https://github.com/SuperDude88/TWWHD-Randomizer). Alongside the
usual item and location tracking, it reads the hints you type, works out logical spheres from
what you have found, and shows where each boss path can still lead.

## Contents

- [Getting started](#getting-started)
- [Windows and layout](#windows-and-layout)
- [Main Tracker](#main-tracker)
  - [Toolbar](#toolbar)
  - [Item Tracker](#item-tracker)
  - [Sea chart](#sea-chart)
  - [Location lists](#location-lists)
  - [Recording where an item was found](#recording-where-an-item-was-found)
  - [Shard and dungeon entrance column](#shard-and-dungeon-entrance-column)
  - [Dungeons and other areas](#dungeons-and-other-areas)
  - [Charts](#charts)
- [Notes](#notes)
  - [Writing hints](#writing-hints)
  - [Sphere Tracking notes](#sphere-tracking-notes)
- [Hint Panel](#hint-panel)
- [Sphere Tracker](#sphere-tracker)
  - [Columns](#columns)
  - [Cards](#cards)
  - [Lines](#lines)
  - [Boss path cards](#boss-path-cards)
  - [Boss path icons](#boss-path-icons)
  - [Filters](#filters)
- [Settings](#settings)
- [Saving your run](#saving-your-run)
- [Race Tracking](#race-tracking)
- [Mouse and keyboard reference](#mouse-and-keyboard-reference)
- [Building from source](#building-from-source)

---

## Getting started

1. Download the latest release and put `JawryTracker.exe` in a folder of its own. The app
   keeps its data in a `data` folder beside the exe, so the whole folder can be moved or copied
   to another computer.
2. Open the **Main Tracker** settings menu (⚙️ in the toolbar, which shows ⚠️ until a folder is
   set), choose **Change folder** under *Randomizer app folder*, and pick the folder where the randomizer app is located.
3. Picking the folder syncs it: the tracker reads the settings from `config.yaml` to learn your starting gear, excluded locations, required bosses and the seed's
   settings. If you generate a new seed later, ⚙️ and its **Sync** button show ⚠️ until you
   press **Sync**. Your current run never changes on its own.
4. Press **Start New Tracker** in the Control Panel when you start a new seed. If the seed gives
   you random starting items, the tracker switches to *Mark starting* mode so you can click them
   in (see [Toolbar](#toolbar)).

---

## Windows and layout

The tracker is split into sections: **Control Panel**, **Main Tracker**, **Sphere Tracker**,
**Notes** and **Hint Panel**.

- **Control Panel** shows the version and holds **Start New Tracker** and **Settings**.
- Under **Panels**, each section has two buttons. **Dock** shows it in the main window's
  layout, and **Undock** opens it in its own window. They are independent, so a section can be
  docked, undocked, both, or neither.
- Drag a section by its title bar to move it, and drag its right edge to resize it. The title
  bar's ⬚ button pops the section out into its own window and × hides it.
- Popped-out windows remember their size and position. With **Group popout windows** on
  (Settings → General), focusing any tracker window brings the others forward with it.
- The sphere tracker and popped-out windows have their own scale sliders.

---

## Main Tracker

### Toolbar

| Control | What it does |
|---|---|
| **↩︎** (red) | Undo the last action. Undo covers everything that changes the run: notes, checked locations, items, dungeon items, charts, placements, entrances and marked sectors, including actions taken in other windows. Typing in the notes undoes a line at a time. Settings, layout and menus aren't affected. The history lasts while the app is open. |
| **↪︎** (green) | Redo the last undone action. |
| **⚙️** | Tracker settings: see below. Shows ⚠️ when no randomizer folder is set, or when the randomizer's `config.yaml` has changed since the last sync. |
| **Mark starting** | Only shown when the seed gives out random starting items. While it flashes, clicking an item in the Item Tracker marks it as one of this seed's starting items. Click it again, or **>DONE MARKING STARTING ITEMS<** under the item grid, to stop. |
| **Clear dead** | Checks off every location that can't hold anything the seed needs (see [Clear dead](#clear-dead) below). One undo puts them all back, and the tooltip lists what the last press cleared. |
| Ho Ho / Blue Chu checkboxes | Show or hide the Old Man Ho Ho and Blue Chu Jelly markers on the map, when the seed tracks them. |
| **Mark sectors leading to a required boss** | Click sectors on the map to flag them with a marker. While you're marking, sectors where the seed's entrance settings can't put a required boss are shaded and can't be clicked. The marker spins once you can open the door on that sector, and settles once the boss behind it is found. Right-click the map to stop marking. |

**Tracker settings (⚙️)**

- **Sphere calculation**: turns the sphere logic on or off. With it off, the Sphere Tracker shows
  a message instead.
- **Right click clears dependent locations**: when you right-click an area to clear it, also
  clear the locations that can only be reached through it. This works like the randomizer
  tracker's *Clear All Includes Dependent Locations*.
- **Generic Triforce shards**: count shards as a plain 0–8 total on the Triforce instead of
  tracking which shard is which.
- **Display item on location list**: show the icon of the item recorded at each location in the
  location lists.
- **Location tooltip size**: how large the requirement tooltip is drawn.
- **Randomizer app folder** (⚠️ while none is set): **Change folder** picks the folder the
  randomizer app is in and syncs from it. **Sync** re-reads `config.yaml` from that folder, and
  the result shows underneath.

#### Clear dead

Each press checks off what the seed's settings, your hints and your boss marks rule out:

- **Race mode dungeons that aren't required**, with the letters their bosses send. This waits
  until the tracker knows enough: path hints naming every required boss, every required dungeon
  found, or every boss marker from the sea chart placed on the map. Once all the markers are
  placed, a dungeon recorded on an unmarked island is ruled out even before you know the rest.
- **Foolish areas**: every location in the area, plus any dungeon whose entrance is on a foolish
  island, as the randomizer counts it.
- **Not-required items** (`n`): the location a location hint names, and every location that
  needs that item to reach. For an item with several copies, only locations that need every copy
  are cleared. This part waits while any cave, door or misc entrance is still unrecorded, since
  one of those could open another way in. It also skips an item the tracker thinks beating the
  seed needs: either the hint is wrong, or the tracker doesn't know yet which race mode bosses
  are left out.

A location behind an entrance you haven't recorded is never cleared, and neither is a location
a hint says holds a required or possibly required item.

### Item Tracker

The inventory grid is where you track what you own.

- **Left-click** an item to get it, or to advance it to its next stage (swords, bows, wallets
  and other progressive items).
- **Right-click** to step it back or remove it. If you hold multiple of an upgradeable item and at least one of
  them is recorded at a location, a picker asks which copy you meant, so the right location is
  freed.
- **Drag** an item onto a map cell to record a hint for it. This adds `Item at Area` to your
  notes. Right-click mid-drag to open that area's location list, then drop the item on the exact
  location instead.
- The **Triforce** follows the shard column and builds up from the shards you have marked.
  Shards you started with are tinted red. With *Generic Triforce shards* on, it becomes a
  clickable 0–8 counter.
- The **Blue Chu Jelly** counter shows how many jellies you have marked on the map.
- The **chart button** (under Progressive Magic) opens the [chart menu](#charts).
- **GO MODE** appears over the grid once everything needed to beat the game is in hand.
- The row under the grid shows the full name of whatever is under the pointer. This includes
  map areas and location names that the lists shorten.

Below the grid, the summary panel counts locations checked, accessible and remaining.
**View all locations** lists the locations of every area in one list. **View all entrances**
does the same for entrances, and only appears when entrances are shuffled.

### Sea chart

The map shows all 49 sectors of the Great Sea.

- Each sector shows **accessible / remaining** locations:
  - **Blue**: something can be checked now.
  - **Red**: nothing left can be reached yet.
  - **Black**: everything is checked.
  - A **?** in place of the remaining count means the sector has entrances you haven't recorded
    yet.
  - A **-** means the seed puts no locations there.
- **Hint icons** show the items your notes place in that sector. **Ho Ho** and **Blue Chu**
  markers sit along the top and fade once marked.
- **Left-click** a sector to open its [location list](#location-lists).
- **Right-click** a sector to clear it: every location in it is marked checked.
- Dungeon abbreviations on a sector show which dungeon entrance you placed there. Right-click
  one to clear it.

### Location lists

Clicking a sector or area fills the map with its location list. Clicking a location here
toggles it, and right-clicking it starts recording an item.

- **Left-click** a location to mark it checked or unchecked.
- **Right-click** a location to arm it: it and its sector pulse purple, ready for you to say
  what was there. See [Recording where an item was found](#recording-where-an-item-was-found).
- **Hover** a location to see its requirements. Each part is colored by whether you have it,
  and entrance paths are included when entrances are shuffled.
- **Colors:**
  - Red: out of reach.
  - Faded: checked.
  - Teal: checked by a `no` line in your notes.
- The number left of a name is its **sphere**. **?** means it depends on an item you haven't
  placed, and **-** means the logic can't reach it.
- **Clear All** marks the whole list checked.
- **Entrances** switches to the area's entrance list when entrances are shuffled. Click an
  entrance, then choose where it led. **×** forgets a recorded entrance, and **Filter** narrows
  long lists.
- Ho Ho and Blue Chu markers for a sector are marked here, even on sectors with no locations.
- Clicking **x Close**, pressing **Escape** on the keyboard or your mouse's back button goes back a step, then closes the list.

### Recording where an item was found

In a location list, right-click a location to arm it, then click
what was there:

- an item in the Item Tracker
- a shard in the shard column
- a dungeon key, map or compass
- a chart in the chart menu
- an acquired item on the Sphere Tracker that has no location yet

The item is recorded at that location, counted as acquired, and the location is marked checked.
If you already hold every copy of that item, the tracker asks which copy it was and moves it.
Right-click an item in the Item Tracker to cancel instead.

### Shard and dungeon entrance column

The narrow column beside the map:

- **Triforce shards**:
  - Click to mark one found.
  - Right-click to mark one as starting gear (crossed out).
  - Drag one onto the map to record a hint.
  - The tooltip says whether the shard has been hinted.
- **Dungeon entrances** (dungeon entrance randomizer): drag a dungeon's button onto the sector
  its entrance is on, or click the button and then the sector. While you place one, sectors
  where the seed's settings can't put that dungeon are shaded and won't take it. Placing a
  dungeon somewhere new moves it. Right-click a button to clear it.

### Dungeons and other areas

The row under the map holds the six dungeons and four other areas: **Mailbox**, **Great Sea**,
**Hyrule** and **Ganon's Tower**. They work like map sectors: click one for its location list,
right-click to clear it.

- A boss portrait changes to its defeated art once its heart container location is checked.
- Above each dungeon are its **small keys** (counted up to that dungeon's total), **big key**,
  **map** and **compass**. Click to add or cycle, right-click to step back, and drag one onto the
  map to record a hint.

### Charts

The chart menu is a 7×7 sea chart with one cell per sector, so a chart's position shows which
island it maps.

- Click a chart to mark it held.
- Drag it onto the map to record a hint.
- Click it while a location is armed to record it there.
- The toggle at the top orders charts by number instead, which works as a checklist of missing
  charts.

---

## Notes

The Notes section has two tabs: **Hint Notes**, for the hints you collect, and **Sphere
Tracking**, a text view of every item recorded at a location. **Grow with text** lets the box
grow as you write. Untick it to keep a fixed height you can drag to resize.

### Writing hints

Write one hint per line. Names don't have to be exact: the tracker matches what you type to the
closest item, area, location or boss, so short forms work.

| You write | Meaning |
|---|---|
| `dragon roost to gohma` | **Path hint**: an item on the path to Gohma is somewhere on Dragon Roost Island. |
| `pawprint and forest haven to gohdan` | Path hint naming two areas: one item, somewhere both areas lead to. |
| `hookshot at needle rock` | **Item hint**: the Hookshot is somewhere in an area. `in` and `on` work too. |
| `bombs in windfall jail maze chest` | **Location hint**: when the text matches a single location, the hint points at that location. |
| `sword r at headstone` | Item hint marked **required**. Add `r`, `p` or `n` after the item for *required*, *possibly required* or *not required*. |
| `no ganon maze` | Marks an area or a single location as checked without visiting it. Several areas can be named at once, and the line shows in red. |

Common abbreviations work for areas, for example **FF**, **DRI**, **DRC**, **FW**, **FH**,
**GT**, **NFI** and **SFI**, and for bosses, for example **KD**. A line the tracker can't read
confidently shows up under **Review** in the Hint Panel.

Right-clicking a hint card in the Hint Panel, or a hint card on the Sphere Tracker, deletes its
line from the notes.

### Sphere Tracking notes

Each line is `Item at Location`. The tab lists everything recorded on the map and the sphere tracker, and
you can edit it as text to add, change or remove placements in bulk.

---

## Hint Panel

The Hint Panel shows your notes as cards: what was hinted on one side, where it is on the other.

- **Filters** shows or hides the tabs: **All**, **Path**, **Items**, **Locations** and
  **Review**.
- Click an item hint's requirement tag to cycle *required*, *possibly required*, *not required*
  and back. This rewrites the line in your notes.
- Right-click a card to delete its line.
- **Hint arrow position** in Settings → Appearance moves the arrow on the cards.

---

## Sphere Tracker

The Sphere Tracker lays out your recorded finds in **logical spheres**, the order the logic says
you could have collected them in. It shows what each item opened, and where each boss path can
still go.

### Columns

- **Start**: your starting gear.
- **Sphere 0, 1, 2 …**: each column holds the items found at locations reachable in that sphere,
  plus **Available** area groups listing the unchecked locations reachable there.
  - A dungeon key counted on the dungeon row but not recorded at a chest still opens its doors.
    It counts from the sphere where every chest that could have held it has been reached, which
    can be later than the key really came. Record it at its chest for the exact sphere.
  - A required boss counts as beaten from the sphere after its arena is reached, as in the
    spoiler log. So nothing that needs it, like Ganondorf, can come earlier than that sphere.
- **Sphere ?**: items with no known sphere. That includes items acquired without a location,
  hinted items and shards, and out-of-logic finds.
- **After sphere ?**, **2 steps after ?** …: locations and items that open up once the unknowns
  resolve, in order.
- **Paths**: boss path cards whose boss isn't reachable yet.

### Cards

- **Placement cards**: an item and the location it was found at.
  - The card shows its sphere, **Optional** when the minimal playthrough doesn't need it, and
    **Out of logic** when nothing recorded yet reaches that location.
  - Right-click a placement card to remove the placement and un-acquire the item.
- **Available area groups**: unchecked locations grouped by area. Click a location to arm it for
  recording an item. **Expand all / Collapse all** in the Start column opens or closes every
  group.
- **No location cards**: items you acquired without saying where. Click one while a location is
  armed to place it, or right-click it to un-acquire it.
- **Hinted item cards**: an item hint whose exact location isn't known yet. The card shows which
  spheres its remaining locations fall into.

### Lines

- A line from one card to another means the second needed the first.
- **Purple lines** mark a boss path: the chain from the item found in a hinted area up to that
  boss's card. They are dashed when the card still has several candidates.
- A line is left out when the same connection already runs through other cards, so a card's full
  ancestry is always there, just with fewer lines.
- **Hover** a card to highlight its chain and dim everything else.

### Boss path cards

Each path hint gets a card with the boss, the hinted area and where the boss currently sits:
a sphere, a relative step, or *Sphere unknown*.

- While the boss can't be reached, the card lists **candidates**: items found in the hinted area
  that could be its path item.
- Once the boss can be reached, the card lists the **linked items** that opened it, plus the path
  item if it sits further back.
- A **solid purple ring** marks the path item. **Dashed rings** mark each item it could still be.
- A hint written twice shows once, with **×2** after the area: two path items in the same area.
- Right-click a path card to delete its hint line.

### Boss path icons

Small boss icons on locations and area headers mark the places where that boss's path item could
still be. Two icons of the same boss mean two of its path items are still unfound there. The
icons disappear as path items are found and as the boss's sphere becomes known. Turn them off
with **Path icons** next to the Filters button.

### Filters

The **Filters** menu narrows the board to what matters:

- **Paths**:
  - Shows only the boss paths (the purple cards).
  - Also shows items that could still turn out to be on one. These are items found after a
    candidate for a boss that isn't reached yet, or out-of-logic items, whose branch still leads
    to unchecked locations.
  - They hide again once their branch is a dead end.
- **Paths + required**: the boss paths, plus every item that beating the seed depends on.
  Items with unexplored branches stay visible until those branches are checked (or until you are
  in go mode). Cards marked *Optional* are hidden.
- **Show keys**: keeps dungeon keys visible whatever the other filters say.

**Locations**, next to Path icons, hides the locations each sphere opens up, leaving only the
items and their lines. A sphere with nothing else in it is hidden too. The Filters work the same
either way: an item whose branch still leads to unchecked locations stays visible under Paths.

The **Scale** slider zooms the board.

A spinning circle is displayed in the corner when the sphere calculation is running.

---

## Settings

Open **Settings** from the Control Panel.

- **General**: **Group popout windows**, which brings every tracker window forward together.
- **Appearance**:
  - Page background and panel colors, item icon size and hint arrow position.
  - **Stream mode** makes the Hint Panel see-through and paints a **stream backdrop** color
    behind the hint panel, item grid and dungeon row, ready for a chroma key.
  - **Presets** has built-in color sets.
  - **Custom Color Presets** saves your own.
- **Layout**:
  - Save and load window layouts, or **Reset layout to default**.
  - **Import portable preferences…** copies the layout and every preset from an older copy of
    the app. Point it at that copy's folder or its `data` folder. Your run isn't included: to
    carry that over, copy the whole `data` folder before the first launch, or use the autosave
    (see [Saving your run](#saving-your-run)).
- **Race Tracking**: links trackers for a race shown on one stream. See
  [Race Tracking](#race-tracking).
- **Load saves**: named saves of your run, and loading a spoiler log. See
  [Saving your run](#saving-your-run).

Presets and saves can live in the **app folder** (portable, beside the exe) or the **user
folder** (`Documents/JawryTracker`, shared by every copy of the app on the computer).

---

## Saving your run

- Your run is saved automatically as you play. A copy is mirrored to `data/autosave.json` beside
  the exe.
- If the app ever starts with an empty run, it restores from `autosave.json`. To move a run to
  another copy of the app, copy that file into the other copy's `data` folder before starting it,
  or use **Load autosave file…**.
- **Load saves → Save as** keeps a named copy that the autosave never overwrites. **Load run from
  savefile** brings it back.
- **Refresh Autosave** re-reads this copy's `autosave.json`, for example after you swapped the
  file in by hand.
- **Load spoiler log…** replaces the run with a spoiler log's seed:
  - its settings, starting island and random starting items
  - its entrances
  - its hints, written into the notes in the log's order. A hint several Old Man Ho Hos repeat
    word for word is written once, but a repeated path hint stays: it means a second path item
    in that area. A foolish area, and a location hinted to hold something the seed doesn't need,
    are written as `no` lines.
  - every item its playthrough finds, recorded at its location, with the location checked
  - in Race Mode, the sectors leading to the bosses the playthrough beats
  - if the playthrough buys from the Potion Shop, enough Blue Chu Jellies to make 15. The log
    doesn't say which ones the run picked up, so the first ones on the map are marked.

  Then it runs [Clear dead](#clear-dead).
- The tracker keeps its working data in the `data` folder next to the exe. Keep that folder on a
  drive that stays connected while you play.

---

## Race Tracking

For a race shown on one stream: each runner's tracker operator links their JawryTracker to the
stream host's. All of it is in **Settings → Race Tracking**, and a tracker that isn't racing
shows none of it.

- **Hosting**:
  - Sync your seed settings first: runners take the host's. Then pick how many runners (2 to 4)
    and **Create race room**. This replaces your run, so save it first if you want to keep it.
  - Send each runner's tracker operator their **runner code**.
  - Your tracker combines the runners' runs into one: every item placement, checked location,
    entrance and hint line any of them has recorded. Your Sphere Tracker works from that, so it
    shows everything known about the seed. Changes you make yourself are replaced by the next
    update.
  - Hint lines that mean the same thing are merged, however each runner typed them, and your
    notes show them spelled out in full: `diamond to jalh` becomes `Diamond Steppe Island to
    Jalhalla`. Dungeons keep their abbreviations, like `ET to Gohma`. Lines that aren't hints,
    or that the tracker can't read for certain, stay as the runner typed them.
  - The same hint from two runners is kept once. One runner writing a hint twice keeps it twice,
    since a seed can give the same path hint twice.
  - If two trackers record different items at the same location, the newer one is kept and the
    tab lists the disagreement.
  - The tab shows which runners are connected and when each last sent an update.
- **Stream display**: each runner has an address like `http://127.0.0.1:4747/?stream=1`. Add it
  to OBS as a **Browser Source**. It shows that runner's own items and dungeon row on a
  transparent background, scaled to the source's size. The address stays the same from one race
  to the next, so the OBS scene only needs setting up once. It shows while your tracker is
  hosting.
- **Grid layout**: turn on **Grid layout** under **Browser sources** to show each runner's
  items as a grid of square black cells instead, like race restreams use. Set how many columns
  and rows it has, and the tab says whether this seed's items fit.
  - The grid is always 800 pixels wide, so it looks the same on every stream. The tab gives the
    size to set each Browser Source to in OBS, like `800 × 398` for 8 by 4.
  - The items are the ones the seed's settings leave to find. Items the seed starts you with
    in full are left out, as is the sword in swordless. The bosses are along the bottom in race
    mode. If the grid is too small, the least important items are left out first.
  - Items not found yet are dimmed. The Triforce shows the runner's shards the way their
    tracker does, as pieces or as a count.
  - Every runner races the same bosses, so the host works them out from all the runs
    together. Path hints, chart marks and the seed's number of required dungeons show which
    bosses are required. Bosses that aren't required are dimmed and crossed out. A runner's
    beaten bosses get a green check.
- **Generic Triforce shards**: turn it on under **Browser sources** to make every runner's
  Triforce show a shard count, in either layout, even when their tracker shows which shards
  they have.
- **Tracking for a runner**: paste the runner code into **Track for a runner** and press
  **Join**. If your seed settings differ from the host's, joining syncs them to the host's
  first. From then on, your run is sent to the host as you track, and your tracker keeps the
  host's seed settings until you leave: a Sync from the ⚙️ menu only updates the logic. Start a
  new tracker before joining if it still holds another seed.
- **End race** or **Leave race** disconnects. The host keeps the combined run.
- Trackers reconnect by themselves if the connection drops, and after a restart. Rooms expire
  two days after they're created.
- Races go through a small relay server, the `relay` folder in this repository. Trackers use a
  public one by default. A tournament can run its own copy (see [relay/README.md](relay/README.md))
  and enter its address under **Relay server**. Everyone in a race has to use the same one.

---

## Mouse and keyboard reference

| Where | Left-click | Right-click | Drag |
|---|---|---|---|
| Item Tracker | Get / next stage (or record at the armed location) | Step back / remove (or cancel the armed location) | Onto the map: record a hint (right-click mid-drag to pick a location) |
| Map sector or area cell | Open location list | Clear the area | Drop items and dungeon entrances here |
| Location list | Check / uncheck | Arm for recording an item | Drop a dragged item on an exact location |
| Shard column | Mark found | Mark as starting gear | Onto the map: record a hint |
| Dungeon key, map, compass | Add / cycle | Step back | Onto the map: record a hint |
| Dungeon entrance button | Arm, then click a sector | Clear | Onto its sector |
| Sphere Tracker placement card | | Remove placement, un-acquire | |
| Sphere Tracker area group location | Arm for recording an item | | |
| Hint card / path card | Cycle requirement (on the tag) | Delete the hint line | |

**Escape** or the mouse back button steps back out of a location list.

---

## Building from source

See [BUILDING.md](BUILDING.md).

## License

[MIT](LICENSE)
