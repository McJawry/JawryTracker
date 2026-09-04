// @ts-nocheck
// Ported as-is from the original vanilla-JS app - untyped legacy code, typed
// gradually as real features get built on top of it rather than forcing full
// strict typing onto it up front. Its public API surface is typed properly at
// the boundary in src/lib/logic/index.ts instead. This comment and the
// directive above are the only change from the original file.
(function initializeSphereEngine(global) {
  "use strict";

  const EXPRESSION_CACHE = new Map();
  const DUNGEON_ACCESS_MACROS = {
    "dragon roost cavern": "Can Access Dragon Roost Cavern",
    "forbidden woods": "Can Access Forbidden Woods",
    "tower of the gods": "Can Access Tower of the Gods",
    "forsaken fortress": "Can Access Forsaken Fortress",
    "earth temple": "Can Access Earth Temple",
    "wind temple": "Can Access Wind Temple"
  };
  const VANILLA_DUNGEON_SECTORS = {
    "dragon roost cavern": "Dragon Roost Island",
    "forbidden woods": "Forest Haven",
    "tower of the gods": "Tower of the Gods Sector",
    "earth temple": "Headstone Island",
    "wind temple": "Gale Isle"
  };
  const SECTOR_ENTRANCE_REQUIREMENTS = {
    "dragon roost island": "Can Access Dungeon Entrance on Dragon Roost Island",
    "forest haven": "Can Access Dungeon Entrance in Forest Haven Sector",
    "tower of the gods sector": "Can Access Dungeon Entrance in Tower of the Gods Sector",
    "forsaken fortress": "Can Get Past Forsaken Fortress Gate",
    "forsaken fortress sector": "Can Get Past Forsaken Fortress Gate",
    "headstone island": "Can Access Dungeon Entrance on Headstone Island",
    "gale isle": "Can Access Dungeon Entrance on Gale Isle"
  };

  // Hoisted out of getInventoryCount/canonicalInventoryName/addInventoryItem: those
  // run on nearly every expression evaluation, so allocating these afresh per call
  // (as literals inside the function body) was a hot-path GC cost.
  const INVENTORY_COUNT_ALIASES = {
    bomb: "bombs",
    bombs: "bombs",
    sail: "progressive sail",
    "bomb bag": "progressive bomb bag",
    quiver: "progressive quiver",
    "boats sail": "progressive sail",
    "tingle tuner": "tingle bottle",
    "magic meter": "progressive magic meter",
    "magic meter upgrade": "progressive magic meter"
  };
  const PROGRESSIVE_ITEM_REQUIREMENTS = {
    "heros bow": ["progressive bow", 1],
    "fire arrows": ["progressive bow", 2],
    "ice arrows": ["progressive bow", 2],
    "light arrows": ["progressive bow", 3],
    "heros sword": ["progressive sword", 1],
    "master sword": ["progressive sword", 2],
    "master sword with half power": ["progressive sword", 3],
    "master sword with full power": ["progressive sword", 4],
    "full power master sword": ["progressive sword", 4],
    "heros shield": ["progressive shield", 1],
    "mirror shield": ["progressive shield", 2],
    "picto box": ["progressive picto box", 1],
    "deluxe picto box": ["progressive picto box", 2],
    "wallet upgrade": ["progressive wallet", 1],
    "1000 rupee wallet": ["progressive wallet", 1],
    "5000 rupee wallet": ["progressive wallet", 2]
  };
  const CANONICAL_INVENTORY_ALIASES = {
    bomb: "bombs",
    sail: "progressive sail",
    "bomb bag": "progressive bomb bag",
    quiver: "progressive quiver",
    "magic meter upgrade": "progressive magic meter"
  };
  const DUNGEON_KEY_AREAS = new Set(["Dragon Roost Cavern", "Forbidden Woods", "Tower of the Gods", "Earth Temple", "Wind Temple"]);

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[']/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const DELAYED_BOSS_MAIL_PREREQUISITES = new Map([
    ["Mailbox - Letter from Baito", "Earth Temple - Jalhalla Heart Container"],
    ["Mailbox - Letter from Orca", "Forbidden Woods - Kalle Demos Heart Container"],
    ["Mailbox - Letter from Aryll", "Forsaken Fortress - Helmaroc King Heart Container"],
    ["Mailbox - Letter from Tingle", "Forsaken Fortress - Helmaroc King Heart Container"]
  ].map(([mailLocation, bossLocation]) => [normalize(mailLocation), normalize(bossLocation)]));

  function stripComment(line) {
    let quoted = false;
    let result = "";
    for (const character of String(line || "")) {
      if (character === '"') quoted = !quoted;
      if (character === "#" && !quoted) break;
      result += character;
    }
    return result.trim();
  }

  function unwrapYamlValue(value) {
    const clean = String(value || "").trim();
    if (clean.length >= 2 && ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'")))) {
      return clean.slice(1, -1).trim();
    }
    return clean;
  }

  function parseLogicData(itemLocationText, macroText, locationDataText = "", entranceTableText = "") {
    const world = parseWorldData(itemLocationText);
    if (world) {
      world.locationMetadata = parseLocationMetadata(locationDataText);
      const entranceData = parseEntranceShuffleData(entranceTableText);
      world.shuffleEntrances = entranceData.entries;
      world.shuffleEntranceByEdge = entranceData.byEdge;
    }
    return {
      locations: world ? world.locations : parseLocationNeeds(itemLocationText),
      macros: parseMacros(macroText),
      world
    };
  }

  function parseWorldData(text) {
    if (!/^\s*-\s+Name\s*:/m.test(String(text || ""))) return null;

    const areas = {};
    const locations = [];
    let currentArea = null;
    let currentSection = "";
    let currentEntry = null;

    const finishEntry = () => {
      if (!currentArea || !currentSection || !currentEntry) return;
      const expression = unwrapYamlValue(currentEntry.parts.join(" ").replace(/\s+/g, " ")) || "Nothing";
      if (currentSection === "locations") {
        currentArea.locations.push({ name: currentEntry.name, need: expression });
        locations.push({ name: currentEntry.name, need: expression, area: currentArea.name });
      } else {
        currentArea[currentSection][normalize(currentEntry.name)] = {
          name: currentEntry.name,
          need: expression
        };
      }
      currentEntry = null;
    };

    String(text || "").split(/\r?\n/).forEach((rawLine) => {
      const indent = rawLine.match(/^\s*/)[0].length;
      const clean = stripComment(rawLine);
      if (!clean) return;

      const areaMatch = clean.match(/^-\s+Name\s*:\s*(.+)$/i);
      if (indent === 0 && areaMatch) {
        finishEntry();
        const name = unwrapYamlValue(areaMatch[1]);
        currentArea = {
          name,
          locations: [],
          events: {},
          exits: {},
          island: "",
          dungeon: "",
          // Which area heading an entrance in here is listed under. Upstream
          // groups the tracker's entrance lists by findHintRegions(), which
          // reads this same field (Area::hintRegion) before falling back to
          // the island or dungeon an area belongs to.
          hintRegion: "",
          dungeonStartingRoom: ""
        };
        areas[normalize(name)] = currentArea;
        currentSection = "";
        return;
      }

      if (!currentArea) return;
      if (indent === 2) {
        finishEntry();
        const sectionMatch = clean.match(/^(Locations|Events|Exits)\s*:\s*$/i);
        if (sectionMatch) {
          currentSection = sectionMatch[1].toLowerCase();
          return;
        }
        currentSection = "";
        const metadataMatch = clean.match(/^(.+?)\s*:\s*(.*)$/);
        if (!metadataMatch) return;
        const key = normalize(metadataMatch[1]);
        const value = unwrapYamlValue(metadataMatch[2]);
        if (key === "island") currentArea.island = value;
        if (key === "hint region") currentArea.hintRegion = value;
        if (key === "dungeon") currentArea.dungeon = value;
        if (key === "dungeon starting room") currentArea.dungeonStartingRoom = value;
        return;
      }

      if (!currentSection) return;
      if (indent === 6) {
        finishEntry();
        const entryMatch = clean.match(/^(.+?)\s*:\s*(.*)$/);
        if (!entryMatch) return;
        currentEntry = {
          name: unwrapYamlValue(entryMatch[1]),
          parts: entryMatch[2] ? [entryMatch[2]] : []
        };
        return;
      }

      if (indent > 6 && currentEntry) currentEntry.parts.push(clean);
    });

    finishEntry();
    const dungeonStarts = {};
    Object.values(areas).forEach((area) => {
      if (area.dungeonStartingRoom) dungeonStarts[normalize(area.dungeonStartingRoom)] = area.name;
    });
    const chartMacroByIsland = {};
    locations.forEach((location) => {
      const chartMatch = location.need.match(/\bChart_For_Island_(\d+)\b/i);
      if (chartMatch) chartMacroByIsland[normalize(location.area)] = `Chart For Island ${chartMatch[1]}`;
    });
    return { areas, locations, dungeonStarts, chartMacroByIsland, startArea: "Root" };
  }

  function parseLocationMetadata(text) {
    const metadata = {};
    let current = null;
    let section = "";

    const finish = () => {
      if (!current?.name) return;
      metadata[normalize(current.name)] = current;
    };

    String(text || "").split(/\r?\n/).forEach((rawLine) => {
      const clean = stripComment(rawLine);
      const indent = rawLine.match(/^\s*/)[0].length;
      if (!clean) return;
      if (indent === 0 && /^-\s+Names\s*:/i.test(clean)) {
        finish();
        current = { name: "", originalItem: "", categories: [] };
        section = "names";
        return;
      }
      if (!current) return;
      if (indent === 2) {
        const field = clean.match(/^(.+?)\s*:\s*(.*)$/);
        if (!field) return;
        section = normalize(field[1]);
        if (section === "original item") current.originalItem = unwrapYamlValue(field[2]);
        return;
      }
      if (section === "names" && indent === 4) {
        const name = clean.match(/^English\s*:\s*(.+)$/i);
        if (name) current.name = unwrapYamlValue(name[1]);
      } else if (section === "category" && indent === 4) {
        const category = clean.match(/^-\s*(.+)$/);
        if (category) current.categories.push(unwrapYamlValue(category[1]));
      }
    });
    finish();
    return metadata;
  }

  function parseEntranceShuffleData(text) {
    const entries = [];
    let current = null;
    const finish = () => {
      if (current?.forward?.parent && current?.forward?.connected) entries.push(current);
    };
    const parseSide = (value) => {
      const parts = String(value || "").split(",").map((part) => part.trim());
      return { parent: parts[0] || "", connected: parts[1] || "" };
    };

    String(text || "").split(/\r?\n/).forEach((rawLine) => {
      const clean = stripComment(rawLine);
      if (!clean) return;
      const typeMatch = clean.match(/^-\s+Type\s*:\s*(\S+)/i);
      if (typeMatch) {
        finish();
        current = { type: typeMatch[1].toUpperCase(), forward: null, reverse: null };
        return;
      }
      if (!current) return;
      const sideMatch = clean.match(/^(Forward|Return)\s*:\s*(.+)$/i);
      if (!sideMatch) return;
      current[sideMatch[1].toLowerCase() === "forward" ? "forward" : "reverse"] = parseSide(sideMatch[2]);
    });
    finish();

    const byEdge = {};
    entries.forEach((entry) => {
      [entry.forward, entry.reverse].filter(Boolean).forEach((side) => {
        byEdge[normalize(`${side.parent} -> ${side.connected}`)] = { entry, side };
      });
    });
    return { entries, byEdge };
  }

  function parseLocationNeeds(text) {
    const entries = [];
    const lines = String(text || "").split(/\r?\n/);
    let current = null;
    let collectingNeed = false;

    const finish = () => {
      if (!current || !current.needParts.length) return;
      entries.push({ name: current.name, need: current.needParts.join(" ") });
    };

    lines.forEach((rawLine) => {
      const indent = rawLine.match(/^\s*/)[0].length;
      const clean = stripComment(rawLine);
      if (!clean) return;

      if (indent === 0) {
        const match = clean.match(/^(.+?):\s*$/);
        if (!match) return;
        finish();
        current = { name: match[1].replace(/^["']|["']$/g, ""), needParts: [] };
        collectingNeed = false;
        return;
      }

      if (!current) return;
      const needMatch = clean.match(/^Need\s*:\s*(.*)$/i);
      if (needMatch) {
        collectingNeed = true;
        if (needMatch[1]) current.needParts.push(needMatch[1]);
        return;
      }

      if (/^[A-Za-z][A-Za-z ]+\s*:/.test(clean)) {
        collectingNeed = false;
        return;
      }

      if (collectingNeed) current.needParts.push(clean);
    });

    finish();
    return entries;
  }

  function parseMacros(text) {
    const macros = {};
    const lines = String(text || "").split(/\r?\n/);
    let currentName = "";
    let parts = [];

    const finish = () => {
      if (currentName && parts.length) macros[normalize(currentName)] = unwrapYamlValue(parts.join(" "));
    };

    lines.forEach((rawLine) => {
      const indent = rawLine.match(/^\s*/)[0].length;
      const clean = stripComment(rawLine);
      if (!clean) return;

      if (indent === 0) {
        const match = clean.match(/^(.+?):\s*(.*)$/);
        if (!match) return;
        finish();
        currentName = match[1].replace(/^["']|["']$/g, "");
        parts = match[2] ? [match[2]] : [];
        return;
      }

      if (currentName) parts.push(clean);
    });

    finish();
    return macros;
  }

  function parseConfig(text) {
    const options = {};
    String(text || "").split(/\r?\n/).forEach((rawLine) => {
      if (!rawLine.trim() || /^\s/.test(rawLine) || rawLine.trimStart().startsWith("#")) return;
      const match = stripComment(rawLine).match(/^([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/);
      if (!match) return;
      options[match[1]] = parseConfigValue(match[2]);
    });
    return options;
  }

  function parseConfigValue(value) {
    const clean = String(value || "").trim().replace(/^["']|["']$/g, "");
    if (/^true$/i.test(clean)) return true;
    if (/^false$/i.test(clean)) return false;
    if (/^null$/i.test(clean) || !clean) return null;
    if (/^-?\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
    if (clean.startsWith("[") && clean.endsWith("]")) {
      return clean.slice(1, -1).split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    return clean;
  }

  function tokenize(expression) {
    const source = unwrapYamlValue(expression);
    const tokens = [];
    let atom = "";
    let index = 0;
    const flush = () => {
      if (atom.trim()) tokens.push(atom.trim());
      atom = "";
    };
    const isBoundary = (character) => !character || !/[A-Za-z0-9_]/.test(character);

    while (index < source.length) {
      const functionMatch = source.slice(index).match(/^(can_access|count|health)\s*\(/i);
      if (functionMatch) {
        flush();
        let depth = 0;
        let end = index;
        for (; end < source.length; end += 1) {
          if (source[end] === "(") depth += 1;
          if (source[end] === ")") {
            depth -= 1;
            if (depth === 0) {
              end += 1;
              break;
            }
          }
        }
        tokens.push(source.slice(index, end).trim());
        index = end;
        continue;
      }

      const character = source[index];
      if (["&", "|", "(", ")"].includes(character)) {
        flush();
        tokens.push(character);
        index += 1;
        continue;
      }

      const lower = source.slice(index).toLowerCase();
      const operator = ["and", "or"].find((word) => lower.startsWith(word)
        && isBoundary(source[index - 1]) && isBoundary(source[index + word.length]));
      if (operator) {
        flush();
        tokens.push(operator === "and" ? "&" : "|");
        index += operator.length;
        continue;
      }

      atom += character;
      index += 1;
    }

    flush();
    return tokens;
  }

  function compileExpression(expression) {
    const cacheKey = unwrapYamlValue(expression);
    if (EXPRESSION_CACHE.has(cacheKey)) return EXPRESSION_CACHE.get(cacheKey);
    const tokens = tokenize(cacheKey);
    let index = 0;

    function parseOr() {
      let node = parseAnd();
      while (tokens[index] === "|") {
        index += 1;
        node = { type: "or", left: node, right: parseAnd() };
      }
      return node;
    }

    function parseAnd() {
      let node = parsePrimary();
      while (tokens[index] === "&") {
        index += 1;
        node = { type: "and", left: node, right: parsePrimary() };
      }
      return node;
    }

    function parsePrimary() {
      if (tokens[index] === "(") {
        index += 1;
        const node = parseOr();
        if (tokens[index] === ")") index += 1;
        return node;
      }
      return { type: "atom", value: tokens[index++] || "Impossible" };
    }

    const compiled = parseOr();
    EXPRESSION_CACHE.set(cacheKey, compiled);
    return compiled;
  }

  function evaluateExpression(expression, context) {
    return evaluateNode(compileExpression(expression), context, new Set());
  }

  function evaluateNode(node, context, macroStack) {
    if (!node) return false;
    if (node.type === "and") return evaluateNode(node.left, context, macroStack) && evaluateNode(node.right, context, macroStack);
    if (node.type === "or") return evaluateNode(node.left, context, macroStack) || evaluateNode(node.right, context, macroStack);
    return evaluateAtom(node.value, context, macroStack);
  }

  // Atom classification is purely a function of the atom's static text (which
  // regex form it matches, and the literal groups it captures) - it never depends
  // on inventory/events/options state. compileExpression already caches the parsed
  // AST per unique expression string, but the same atom text (e.g. "Bombs") recurs
  // across thousands of different location/macro expressions, so classification is
  // cached separately here to avoid re-running ~10 regexes on every evaluation.
  const ATOM_CLASSIFICATION_CACHE = new Map();

  function classifyOptionAtom(value) {
    let match = value.match(/^Option\s+"([^"]+)"\s+(Enabled|Disabled)$/i);
    if (match) return { kind: "option_enabled_disabled", optionName: match[1], enabled: match[2].toLowerCase() === "enabled" };

    match = value.match(/^Option\s+"([^"]+)"\s+(Is|Is Not)\s+"([^"]+)"$/i);
    if (match) return { kind: "option_is", optionName: match[1], isNot: match[2].toLowerCase() === "is not", expected: match[3] };

    match = value.match(/^Option\s+"([^"]+)"\s+Contains\s+"([^"]+)"$/i);
    if (match) return { kind: "option_contains", optionName: match[1], expected: match[2] };

    return null;
  }

  function computeAtomClassification(rawAtom) {
    const rawValue = String(rawAtom || "").trim();
    const value = unwrapYamlValue(rawValue);
    const key = normalize(value);
    if (!key || key === "nothing") return { kind: "true" };
    if (key === "impossible") return { kind: "false" };

    const accessMatch = value.match(/^can_access\s*\((.*)\)$/i);
    if (accessMatch) return { kind: "can_access", area: normalize(accessMatch[1]) };

    const countFunctionMatch = value.match(/^count\s*\(\s*(\d+)\s*,\s*(.*?)\s*\)$/i);
    if (countFunctionMatch) return { kind: "count_fn", count: Number(countFunctionMatch[1]), item: countFunctionMatch[2] };

    const healthMatch = value.match(/^health\s*\(\s*(\d+)\s*\)$/i);
    if (healthMatch) return { kind: "health", count: Number(healthMatch[1]) };

    const comparisonMatch = value.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
    if (comparisonMatch) {
      return { kind: "comparison", key, optionName: comparisonMatch[1], operator: comparisonMatch[2], expectedRaw: comparisonMatch[3] };
    }

    const locationMatch = value.match(/^Can Access Item Location\s+["'](.+)["']$/i);
    if (locationMatch) return { kind: "location", key, locationKey: normalize(locationMatch[1]) };

    const optionClassification = classifyOptionAtom(value);
    if (optionClassification) return { ...optionClassification, key };

    const dungeonName = Object.keys(DUNGEON_ACCESS_MACROS).find((name) => normalize(DUNGEON_ACCESS_MACROS[name]) === key);
    if (dungeonName) return { kind: "dungeon_access", key, dungeonName };

    const countMatch = value.match(/^(.*?)\s+x(\d+)$/i);
    const itemName = countMatch ? countMatch[1] : value;
    const count = countMatch ? Number(countMatch[2]) : 1;
    return { kind: "item", key, itemName, count };
  }

  function classifyAtom(rawAtom) {
    if (ATOM_CLASSIFICATION_CACHE.has(rawAtom)) return ATOM_CLASSIFICATION_CACHE.get(rawAtom);
    const classification = computeAtomClassification(rawAtom);
    ATOM_CLASSIFICATION_CACHE.set(rawAtom, classification);
    return classification;
  }

  function evaluateAtom(atom, context, macroStack) {
    const classification = classifyAtom(atom);
    if (classification.kind === "true") return true;
    if (classification.kind === "false") return false;
    if (classification.kind === "can_access") return Boolean(context.accessibleAreas?.has(classification.area));
    if (classification.kind === "count_fn") return getInventoryCount(context.inventory, classification.item) >= classification.count;
    if (classification.kind === "health") return getHealthCount(context) >= classification.count;

    if (context.events?.has(classification.key)) return true;

    if (classification.kind === "comparison") {
      const option = getOptionValue(context.options || {}, classification.optionName);
      if (option.found) {
        const expected = parseConfigValue(classification.expectedRaw);
        const equal = typeof expected === "string"
          ? normalize(option.value) === normalize(expected)
          : option.value === expected;
        return classification.operator === "==" ? equal : !equal;
      }
      return false;
    }

    if (classification.kind === "location") {
      const locationStack = context.locationStack || new Set();
      if (locationStack.has(classification.locationKey)) return false;
      const locationRule = context.rules?.[classification.locationKey];
      if (!locationRule) return false;
      const nextLocationStack = new Set(locationStack);
      nextLocationStack.add(classification.locationKey);
      return evaluateNode(compileExpression(locationRule), { ...context, locationStack: nextLocationStack }, macroStack);
    }

    if (classification.kind === "option_enabled_disabled") {
      const option = getOptionValue(context.options || {}, classification.optionName);
      return classification.enabled ? Boolean(option.value) : !Boolean(option.value);
    }

    if (classification.kind === "option_is") {
      const option = getOptionValue(context.options || {}, classification.optionName);
      const equal = normalize(option.value) === normalize(classification.expected);
      return classification.isNot ? !equal : equal;
    }

    if (classification.kind === "option_contains") {
      const option = getOptionValue(context.options || {}, classification.optionName);
      const values = Array.isArray(option.value) ? option.value : [];
      return values.some((value) => normalize(value) === normalize(classification.expected));
    }

    if (classification.kind === "dungeon_access") {
      return evaluateDungeonAccess(classification.dungeonName, context, macroStack);
    }

    const macro = context.macros?.[classification.key];
    if (macro && !macroStack.has(classification.key)) {
      const nextStack = new Set(macroStack);
      nextStack.add(classification.key);
      return evaluateNode(compileExpression(macro), context, nextStack);
    }
    return getInventoryCount(context.inventory, classification.itemName) >= classification.count;
  }

  // The logic files and config.yaml don't always agree on an option's name:
  // world.yaml gates Ganon's Tower's staircase on Skip_Refights, but the
  // randomizer writes that setting out as skip_rematch_bosses. Without the
  // alias the comparison finds nothing, reads as false, and the four boss
  // refights - and so Power Bracelets, via Can_Defeat_Jalhalla - get treated
  // as required for everything past the Trials Hub.
  const OPTION_ALIASES = {
    "skip refights": ["skip rematch bosses"],
    "skip rematch bosses": ["skip refights"]
  };

  function getOptionValue(options, name) {
    const key = normalize(unwrapYamlValue(name));
    for (const candidate of [key, ...(OPTION_ALIASES[key] || [])]) {
      const entry = Object.entries(options).find(([optionName]) => normalize(optionName) === candidate);
      if (entry) return { found: true, value: entry[1] };
    }
    return { found: false, value: undefined };
  }

  function evaluateDungeonAccess(dungeonName, context, macroStack) {
    const randomized = Boolean(getOptionValue(context.options || {}, "randomize_dungeon_entrances").value);
    const mappedSector = context.entranceMappings?.[dungeonName];
    if (randomized && !mappedSector) return false;
    const sector = mappedSector || VANILLA_DUNGEON_SECTORS[dungeonName];
    const requirementName = SECTOR_ENTRANCE_REQUIREMENTS[normalize(sector)];
    if (!requirementName) return false;
    const requirement = context.macros?.[normalize(requirementName)];
    if (!requirement) return false;
    return evaluateNode(compileExpression(requirement), context, macroStack);
  }

  function getHealthCount(context) {
    const startingContainers = ["starting_hcs", "starting_heart_containers", "starting hc"]
      .map((name) => getOptionValue(context.options || {}, name))
      .find((option) => option.found)?.value;
    const startingPieces = ["starting_pohs", "starting_heart_pieces", "starting hp"]
      .map((name) => getOptionValue(context.options || {}, name))
      .find((option) => option.found)?.value;
    const containers = Number.isFinite(Number(startingContainers)) ? Number(startingContainers) : 3;
    const pieces = Number.isFinite(Number(startingPieces)) ? Number(startingPieces) : 0;
    return containers
      + getInventoryCount(context.inventory, "Heart Container")
      + Math.floor((pieces + getInventoryCount(context.inventory, "Piece of Heart")) / 4);
  }

  function getInventoryCount(inventory, itemName) {
    const key = normalize(itemName);
    const requirement = PROGRESSIVE_ITEM_REQUIREMENTS[key];
    if (requirement) {
      const count = inventory[requirement[0]] || 0;
      return count >= requirement[1] ? count : 0;
    }
    return inventory[INVENTORY_COUNT_ALIASES[key] || key] || 0;
  }

  function canonicalInventoryName(itemName) {
    const key = normalize(itemName);
    return CANONICAL_INVENTORY_ALIASES[key] || key;
  }

  function addInventoryItem(inventory, itemName, location) {
    let name = String(itemName || "");
    const area = String(location || "").split(" - ")[0];
    if (/^Small Key$/i.test(name) && DUNGEON_KEY_AREAS.has(area)) name = `${area} Small Key`;
    if (/^(?:Boss|Big) Key$/i.test(name) && DUNGEON_KEY_AREAS.has(area)) name = `${area} Big Key`;
    const key = canonicalInventoryName(name);
    inventory[key] = (inventory[key] || 0) + 1;
  }

  function removeInventoryItem(inventory, itemName, location) {
    const copy = { ...inventory };
    const single = {};
    addInventoryItem(single, itemName, location);
    Object.keys(single).forEach((key) => {
      copy[key] = Math.max(0, (copy[key] || 0) - 1);
    });
    return copy;
  }

  function getInventoryItemKey(itemName, location) {
    const single = {};
    addInventoryItem(single, itemName, location);
    return Object.keys(single).sort().join("|");
  }

  function getSeedMacros(macros, world, options, chartMappings) {
    const seedMacros = { ...(macros || {}) };
    if (!world || !getOptionValue(options || {}, "randomize_charts").value) return seedMacros;

    Object.values(world.chartMacroByIsland || {}).forEach((macroName) => {
      seedMacros[normalize(macroName)] = "Impossible";
    });
    Object.entries(chartMappings || {}).forEach(([chartName, islandName]) => {
      const macroName = world.chartMacroByIsland?.[normalize(islandName)];
      if (!macroName) return;
      const chartRequirement = normalize(chartName).startsWith("triforce chart")
        ? `${String(chartName).replace(/ /g, "_")} and 'Rescued_Tingle' and 'Can_Farm_Lots_Of_Rupees'`
        : String(chartName).replace(/ /g, "_");
      seedMacros[normalize(macroName)] = chartRequirement;
    });
    return seedMacros;
  }

  function sameSector(first, second) {
    const clean = (value) => normalize(value).replace(/\s+sector$/, "");
    return clean(first) === clean(second);
  }

  function isShuffleTypeEnabled(type, options) {
    const option = (name) => getOptionValue(options || {}, name).value;
    if (type === "DUNGEON") return Boolean(option("randomize_dungeon_entrances"));
    if (type === "BOSS") return Boolean(option("randomize_boss_entrances"));
    if (type === "MINIBOSS") return Boolean(option("randomize_miniboss_entrances"));
    if (type === "DOOR") return Boolean(option("randomize_door_entrances"));
    if (type === "MISC" || type === "MISC_RESTRICTIVE") return Boolean(option("randomize_misc_entrances"));
    if (type === "FAIRY") return normalize(option("randomize_cave_entrances")) === "caves and fairies";
    if (type === "CAVE") return !["", "disabled", "false", "none"].includes(normalize(option("randomize_cave_entrances")));
    return false;
  }

  // Entrance wiring reads only the world, the options and the manual
  // connections - never the inventory - but analyzeWorld rebuilt it on every
  // call, which meant once per sphere per candidate test: 232 rebuilds and a
  // second of wall time for one unchanging answer.
  const entranceConnectionCache = new WeakMap();

  function buildEntranceConnections(context) {
    const world = context.world;
    const cached = world ? entranceConnectionCache.get(world) : null;
    if (cached && cached.options === context.options && cached.entranceConnections === context.entranceConnections) {
      return cached.state;
    }
    const state = computeEntranceConnections(context);
    if (world) {
      entranceConnectionCache.set(world, { options: context.options, entranceConnections: context.entranceConnections, state });
    }
    return state;
  }

  function computeEntranceConnections(context) {
    const world = context.world;
    const connections = {};
    const disconnected = new Set();
    if (!world?.shuffleEntrances?.length) return { connections, disconnected };

    world.shuffleEntrances.forEach((entry) => {
      if (!isShuffleTypeEnabled(entry.type, context.options)) return;
      // Both sides. A shuffled door is taken apart in both directions until
      // something is recorded for it: coupled, writing down the way in restores
      // the way back (below); decoupled, the way back is its own discovery and
      // walking out of a cave lands you somewhere else entirely.
      //
      // Leaving reverse sides connected let you walk out of any interior into
      // its vanilla surroundings, which reached places nothing leads to - the
      // Forest Haven ledges are only ever entered from inside, and read as
      // reachable while the door into the Haven led to Cliff Plateau Isles.
      disconnected.add(normalize(`${entry.forward.parent} -> ${entry.forward.connected}`));
      if (entry.reverse) {
        disconnected.add(normalize(`${entry.reverse.parent} -> ${entry.reverse.connected}`));
      }
    });

    const decoupled = Boolean(getOptionValue(context.options || {}, "decouple_entrances").value);

    Object.entries(context.entranceConnections || {}).forEach(([sourceName, targetName]) => {
      let source = world.shuffleEntranceByEdge?.[normalize(sourceName)];
      let target = world.shuffleEntranceByEdge?.[normalize(targetName)];
      const isForward = (match) => match?.entry && normalize(`${match.side.parent} -> ${match.side.connected}`)
        === normalize(`${match.entry.forward.parent} -> ${match.entry.forward.connected}`);

      // Decoupled: each direction is its own discovery, so a record is taken
      // exactly as written - this side came out there - and says nothing about
      // the way back. Mirroring it would invent a connection the seed never
      // made.
      if (decoupled && source && target) {
        const sourceKey = normalize(`${source.side.parent} -> ${source.side.connected}`);
        connections[sourceKey] = target.side.connected;
        disconnected.delete(sourceKey);
        return;
      }

      // A connection recorded from the inside out - "leaving Rose's House put
      // me at X" - is the same pairing as "X's door leads into Rose's House",
      // so mirror it rather than ignoring it. Some interiors have an
      // unrandomized second way in, which is how you come to know an exit
      // before you know the entrance. Coupled seeds only.
      if (source && target && !isForward(source) && !isForward(target)) {
        const exitedEntry = source.entry;
        const arrivedEntry = target.entry;
        source = { entry: arrivedEntry, side: arrivedEntry.forward };
        target = { entry: exitedEntry, side: exitedEntry.forward };
      }
      if (!isForward(source) || !isForward(target)) return;
      const sourceKey = normalize(`${source.entry.forward.parent} -> ${source.entry.forward.connected}`);
      connections[sourceKey] = target.entry.forward.connected;
      disconnected.delete(sourceKey);

      if (!getOptionValue(context.options || {}, "decouple_entrances").value && source.entry.reverse && target.entry.reverse) {
        const reverseKey = normalize(`${target.entry.reverse.parent} -> ${target.entry.reverse.connected}`);
        connections[reverseKey] = source.entry.forward.parent;
        disconnected.delete(reverseKey);
      }
    });
    return { connections, disconnected };
  }

  function resolveExitTarget(sourceArea, exitName, context) {
    const world = context.world;
    if (!world) return exitName;

    // Randomized starting island isn't part of the entrance-shuffle table at all - the
    // randomizer just rewrites where "Link's Spawn" leads at world-build time (see
    // World.cpp: Link's Spawn's exit is set to the rolled starting area). So this is
    // handled as its own override rather than going through shuffleEntranceByEdge.
    if (context.startingIsland && normalize(sourceArea.name) === "links spawn" && normalize(exitName) === "outset island") {
      return context.startingIsland;
    }

    const edgeKey = normalize(`${sourceArea.name} -> ${exitName}`);
    const entranceState = context.entranceState || { connections: {}, disconnected: new Set() };
    if (entranceState.connections[edgeKey]) return entranceState.connections[edgeKey];

    const shuffleEntry = world.shuffleEntranceByEdge?.[edgeKey];
    if (!shuffleEntry || !isShuffleTypeEnabled(shuffleEntry.entry.type, context.options)) return exitName;
    if (!entranceState.disconnected.has(edgeKey)) return exitName;

    // Manual dungeon badges predate autosave entrance syncing and remain a useful
    // fallback. Only the five entrances in the official shuffle table participate;
    // Forsaken Fortress is deliberately not one of them.
    const isForward = normalize(`${shuffleEntry.side.parent} -> ${shuffleEntry.side.connected}`)
      === normalize(`${shuffleEntry.entry.forward.parent} -> ${shuffleEntry.entry.forward.connected}`);
    if (shuffleEntry.entry.type !== "DUNGEON" || !isForward) return "";

    const targetArea = world.areas[normalize(exitName)];
    const dungeonName = targetArea?.dungeonStartingRoom;
    if (!dungeonName || normalize(sourceArea.dungeon) === normalize(dungeonName)) return exitName;

    const physicalSector = VANILLA_DUNGEON_SECTORS[normalize(dungeonName)];
    const mappedDungeon = Object.entries(context.entranceMappings || {})
      .find(([, sector]) => sameSector(sector, physicalSector))?.[0];
    return mappedDungeon ? world.dungeonStarts[normalize(mappedDungeon)] || "" : "";
  }

  // Object.values() on every area, on every pass, on every call allocated
  // hundreds of thousands of throwaway arrays. Keyed on the area object so it
  // survives across calls without writing to the world (which is a reactive
  // proxy on the main thread).
  const areaMemberCache = new WeakMap();
  function getAreaMembers(area) {
    let members = areaMemberCache.get(area);
    if (!members) {
      members = { events: Object.values(area.events), exits: Object.values(area.exits) };
      areaMemberCache.set(area, members);
    }
    return members;
  }

  function analyzeWorld(world, contextBase, seed) {
    if (!world) return { accessibleAreas: null, events: new Set() };
    // Reachability only grows as inventory grows (no logic rule takes items away),
    // so a caller iterating sphere-by-sphere with a monotonically growing inventory
    // (calculateCore's main loop) can seed the next call with the previous sphere's
    // result instead of rediscovering the whole graph from Root every time.
    const accessibleAreas = seed?.accessibleAreas
      ? new Set(seed.accessibleAreas)
      : new Set([
          normalize(world.startArea || "Root"),
          ...(contextBase.additionalStartAreas || []).map(normalize)
        ].filter(Boolean));
    // additionalEvents are the ones the caller already knows have happened -
    // a boss the player has beaten, which the tracker learns from its heart
    // container being checked rather than from the logic being able to walk
    // back into the arena. Only the first call needs them: a seeded call
    // inherits them in seed.events.
    const events = seed?.events
      ? new Set(seed.events)
      : new Set((contextBase.additionalEvents || []).map(normalize));
    const entranceState = buildEntranceConnections({ ...contextBase, world });
    const context = { ...contextBase, world, accessibleAreas, events, entranceState };
    let eventChanged = true;
    let passes = 0;

    // Exit targets depend on the world, the entrance state and the options -
    // all fixed for this call - so each edge is resolved once instead of on
    // every pass over its area.
    const resolvedTargets = new Map();
    // An area whose events have all fired and whose exits all lead somewhere
    // already reachable can never contribute again: both sets only ever grow.
    // Re-scanning them was most of the work in the second and third passes.
    const settledAreas = new Set();
    const targetKeyFor = (area, exit) => {
      let targetKey = resolvedTargets.get(exit);
      if (targetKey === undefined) {
        targetKey = normalize(resolveExitTarget(area, exit.name, context));
        resolvedTargets.set(exit, targetKey);
      }
      return targetKey;
    };

    while (eventChanged && passes < 1000) {
      eventChanged = false;
      passes += 1;
      const pendingAreas = [...accessibleAreas];
      const scannedAreas = new Set();

      // Index cursor rather than shift(): the queue holds every accessible
      // area, and shifting off the front copies the whole array each time.
      for (let cursor = 0; cursor < pendingAreas.length; cursor += 1) {
        const areaKey = pendingAreas[cursor];
        if (scannedAreas.has(areaKey) || settledAreas.has(areaKey)) continue;
        scannedAreas.add(areaKey);
        const area = world.areas[areaKey];
        if (!area) continue;
        const members = getAreaMembers(area);
        let settled = true;

        members.events.forEach((event) => {
          const eventKey = normalize(event.name);
          if (events.has(eventKey)) return;
          if (evaluateExpression(event.need, context)) {
            events.add(eventKey);
            eventChanged = true;
          } else {
            settled = false;
          }
        });

        members.exits.forEach((exit) => {
          // Where the exit goes is settled before asking whether it can be
          // taken. An exit into an area that is already reachable cannot
          // change anything, and evaluating its requirement - which expands
          // macros recursively - is by far the expensive half. On a late-run
          // board 83% of these landed somewhere already known.
          const targetKey = targetKeyFor(area, exit);
          if (!targetKey || !world.areas[targetKey]) return;
          if (accessibleAreas.has(targetKey)) return;
          if (!evaluateExpression(exit.need, context)) {
            settled = false;
            return;
          }
          accessibleAreas.add(targetKey);
          pendingAreas.push(targetKey);
        });

        if (settled) settledAreas.add(areaKey);
      }
    }

    return { accessibleAreas, events };
  }

  // A canonical string key for an inventory snapshot - used to memoize reachability.
  // getReachableLocationSet's true result is a pure function of (locations, rules,
  // world, and the inventory-dependent parts of contextBase): within one calculate()
  // call, `locations`/rules/world/macros/options/entranceMappings/entranceConnections/
  // chartMappings/startingIsland never change - only `inventory` does, across the
  // main sphere loop's ~40 iterations and every candidate-removal test in the pruning
  // loop. Consecutive candidate tests differ from each other (and from the original
  // unpruned run) by at most a handful of removed placements, so long stretches of
  // early-sphere inventory are byte-identical across many separate calculateCore
  // calls. Caching by inventory content lets those calls skip straight to a cached
  // answer instead of re-walking the whole area graph and re-evaluating every
  // location's rule - correctness is untouched, since a memoized pure function
  // returns exactly what a fresh call would have computed.
  function getInventoryCacheKey(inventory) {
    const keys = Object.keys(inventory || {}).sort();
    let key = "";
    for (const inventoryKey of keys) {
      const count = inventory[inventoryKey];
      if (count) key += `${inventoryKey}:${count}|`;
    }
    return key;
  }

  function getReachableLocationSet(locations, rules, world, contextBase, seed, out, reachabilityCache) {
    if (reachabilityCache) {
      const cacheKey = getInventoryCacheKey(contextBase.inventory);
      const cached = reachabilityCache.get(cacheKey);
      if (cached) {
        if (out) {
          out.accessibleAreas = cached.accessibleAreas;
          out.events = cached.events;
        }
        return cached.locationSet;
      }
    }

    const reachability = analyzeWorld(world, contextBase, seed);
    if (out) {
      out.accessibleAreas = reachability.accessibleAreas;
      out.events = reachability.events;
    }
    const context = { ...contextBase, ...reachability, world, rules };
    const locationSet = new Set((locations || []).filter((location) => {
      const key = normalize(location);
      const rule = rules[key];
      if (!rule) return false;
      const areaKey = world?.locationAreas?.[key];
      if (world && areaKey && !reachability.accessibleAreas.has(areaKey)) return false;
      return evaluateExpression(rule, context);
    }).map(normalize));

    if (reachabilityCache) {
      reachabilityCache.set(getInventoryCacheKey(contextBase.inventory), {
        accessibleAreas: reachability.accessibleAreas,
        events: reachability.events,
        locationSet
      });
    }

    return locationSet;
  }

  /**
   * Which areas the current inventory can stand in. analyzeWorld works this
   * out on the way to deciding which locations are reachable; the entrance
   * tracker needs it directly, to say whether you can get to an entrance at
   * all (logic/entrances.ts).
   */
  function getAccessibleAreas({ locations, rules, macros, world, items, options, entranceMappings, entranceConnections, chartMappings, additionalStartAreas, startingIsland, additionalEvents }) {
    const inventory = {};
    (items || []).forEach((item) => addInventoryItem(inventory, item, ""));
    const contextBase = { rules, macros: getSeedMacros(macros, world, options, chartMappings), options, entranceMappings, entranceConnections, chartMappings, additionalStartAreas, startingIsland, additionalEvents, world };
    const out = {};
    getReachableLocationSet(locations || [], rules, world, { ...contextBase, inventory }, undefined, out);
    return out.accessibleAreas || new Set();
  }

  /**
   * Exits you could actually walk through right now, as "Parent -> Connected".
   *
   * Standing in an area is not the same as being able to use every door in it:
   * Outset Mesa's House needs the Song of Passing and Jabun's Cave needs bombs.
   * The entrance tracker colours a row by this, so an entrance you cannot open
   * yet reads red even though the island around it is reachable.
   */
  function getTraversableExits(input) {
    const world = input.world;
    if (!world?.areas) return new Set();
    const inventory = {};
    (input.items || []).forEach((item) => addInventoryItem(inventory, item, ""));
    const contextBase = {
      rules: input.rules,
      macros: getSeedMacros(input.macros, world, input.options, input.chartMappings),
      options: input.options,
      entranceMappings: input.entranceMappings,
      entranceConnections: input.entranceConnections,
      chartMappings: input.chartMappings,
      additionalStartAreas: input.additionalStartAreas,
      additionalEvents: input.additionalEvents,
      startingIsland: input.startingIsland,
      world
    };
    const out = {};
    getReachableLocationSet(input.locations || [], input.rules, world, { ...contextBase, inventory }, undefined, out);
    const context = { ...contextBase, inventory, ...out, world, rules: input.rules };

    const traversable = new Set();
    Object.values(world.areas).forEach((area) => {
      if (!out.accessibleAreas?.has(normalize(area.name))) return;
      Object.values(area.exits || {}).forEach((exit) => {
        if (evaluateExpression(exit.need, context)) traversable.add(normalize(`${area.name} -> ${exit.name}`));
      });
    });
    return traversable;
  }

  function getReachableLocations({ locations, rules, macros, world, items, options, entranceMappings, entranceConnections, chartMappings, additionalStartAreas, startingIsland, additionalEvents }) {
    const inventory = {};
    (items || []).forEach((item) => addInventoryItem(inventory, item, ""));
    const contextBase = { rules, macros: getSeedMacros(macros, world, options, chartMappings), options, entranceMappings, entranceConnections, chartMappings, additionalStartAreas, startingIsland, additionalEvents, world };
    return [...getReachableLocationSet(locations, rules, world, { ...contextBase, inventory })];
  }

  function getReachableWithOwnDungeonKeys(locations, rules, world, contextBase, inventory, ownDungeonKeyPools) {
    const effectiveInventory = { ...inventory };
    let reachable = getReachableLocationSet(locations, rules, world, { ...contextBase, inventory: effectiveInventory });
    if (!ownDungeonKeyPools?.length) return reachable;

    let changed = true;
    while (changed) {
      changed = false;
      ownDungeonKeyPools.forEach(({ item, count, itemPools }) => {
        const itemKey = canonicalInventoryName(item);
        let ownedCount = effectiveInventory[itemKey] || 0;
        while (ownedCount < count) {
          const potentialLocations = itemPools?.[ownedCount] || [];
          const keyIsGuaranteed = potentialLocations.length > 0
            && potentialLocations.every((location) => reachable.has(normalize(location)));
          if (!keyIsGuaranteed) break;

          addInventoryItem(effectiveInventory, item, "");
          ownedCount += 1;
          changed = true;
          reachable = getReachableLocationSet(locations, rules, world, { ...contextBase, inventory: effectiveInventory });
        }
      });
    }
    return reachable;
  }

  function calculateCore({ locations, rules, macros, world, placements, startingGear, options, entranceMappings, entranceConnections, chartMappings, includeDependencies = true, referencedItemKeys, startingIsland, additionalStartAreas, additionalEvents, reachabilityCache }) {
    const inventory = {};
    (startingGear || []).forEach((item) => addInventoryItem(inventory, item, ""));
    const placementByLocation = new Map((placements || []).map((placement) => [normalize(placement.location), placement]));
    const locationSpheres = {};
    const placementSpheres = {};
    const inventoryBeforeSphere = [];
    const sphereLocations = [];
    const bossAvailabilitySpheres = new Map();
    const reachabilityLocations = [...new Set([
      ...(locations || []),
      ...DELAYED_BOSS_MAIL_PREREQUISITES.values()
    ])];
    const contextBase = {
      rules,
      macros: getSeedMacros(macros, world, options, chartMappings),
      options,
      entranceMappings,
      entranceConnections,
      chartMappings,
      startingIsland,
      // Passed through like getAccessibleAreas and getReachableLocations do.
      // Dropping it here left the spheres alone in not knowing about savewarp,
      // so a dungeon entered through a shuffled door had reachable checks that
      // no sphere would own - they read "?" against a perfectly blue location.
      additionalStartAreas,
      additionalEvents,
      world
    };

    let previousReachability = null;
    for (let sphere = 0; sphere < 40; sphere += 1) {
      inventoryBeforeSphere[sphere] = { ...inventory };
      const reachabilityOut = {};
      const reachable = getReachableLocationSet(reachabilityLocations, rules, world, { ...contextBase, inventory }, previousReachability, reachabilityOut, reachabilityCache);
      previousReachability = reachabilityOut;
      DELAYED_BOSS_MAIL_PREREQUISITES.forEach((bossLocationKey) => {
        if (!bossAvailabilitySpheres.has(bossLocationKey) && reachable.has(bossLocationKey)) {
          bossAvailabilitySpheres.set(bossLocationKey, sphere);
        }
      });
      const newlyAccessible = (locations || []).filter((location) => {
        const key = normalize(location);
        if (locationSpheres[key] !== undefined || !reachable.has(key)) return false;
        const bossLocationKey = DELAYED_BOSS_MAIL_PREREQUISITES.get(key);
        if (!bossLocationKey) return true;
        const bossSphere = bossAvailabilitySpheres.get(bossLocationKey);
        return Number.isInteger(bossSphere) && bossSphere < sphere;
      });
      const hasPendingBossMail = (locations || []).some((location) => {
        const key = normalize(location);
        if (locationSpheres[key] !== undefined || !reachable.has(key)) return false;
        const bossLocationKey = DELAYED_BOSS_MAIL_PREREQUISITES.get(key);
        return bossLocationKey && bossAvailabilitySpheres.get(bossLocationKey) === sphere;
      });

      if (!newlyAccessible.length) {
        if (hasPendingBossMail) continue;
        break;
      }

      sphereLocations[sphere] = newlyAccessible;
      newlyAccessible.forEach((location) => {
        locationSpheres[normalize(location)] = sphere;
      });
      const foundPlacements = newlyAccessible.map((location) => placementByLocation.get(normalize(location))).filter(Boolean);
      if (!foundPlacements.length && !hasPendingBossMail) break;
      foundPlacements.forEach((placement) => {
        placementSpheres[placement.id] = sphere;
        addInventoryItem(inventory, placement.item, placement.location);
      });
    }

    const dependencies = {};
    Object.entries(locationSpheres).forEach(([locationKey, sphere]) => {
      if (sphere === 0) {
        dependencies[locationKey] = ["start"];
      }
    });

    if (!includeDependencies) return { locationSpheres, placementSpheres, dependencies, sphereLocations };

    const locationsBySphere = new Map();
    Object.entries(locationSpheres).forEach(([locationKey, sphere]) => {
      if (sphere === 0) return;
      if (!locationsBySphere.has(sphere)) locationsBySphere.set(sphere, []);
      locationsBySphere.get(sphere).push(locationKey);
    });

    locationsBySphere.forEach((locationKeys, sphere) => {
      const inventoryForSphere = inventoryBeforeSphere[sphere] || {};
      const candidateGroups = new Map();
      (placements || []).forEach((placement) => {
        if (placementSpheres[placement.id] === undefined || placementSpheres[placement.id] >= sphere) return;
        const itemKey = getInventoryItemKey(placement.item, placement.location);
        if (!candidateGroups.has(itemKey)) candidateGroups.set(itemKey, []);
        candidateGroups.get(itemKey).push(placement);
      });

      candidateGroups.forEach((candidatePlacements, itemKey) => {
        // Dungeon keys use an area-prefixed key format (see addInventoryItem) that this
        // reference set doesn't model, so only trust the skip for plain canonical keys.
        if (referencedItemKeys && !/(?:small|big|boss) key$/.test(itemKey) && !referencedItemKeys.has(itemKey)) return;
        const representative = candidatePlacements[0];
        const reducedInventory = removeInventoryItem(inventoryForSphere, representative.item, representative.location);
        const reachable = getReachableLocationSet(locations, rules, world, { ...contextBase, inventory: reducedInventory });
        locationKeys.forEach((locationKey) => {
          if (reachable.has(locationKey)) return;
          if (!dependencies[locationKey]) dependencies[locationKey] = [];
          dependencies[locationKey].push(...candidatePlacements.map((placement) => placement.id));
        });
      });
    });

    return { locationSpheres, placementSpheres, dependencies, sphereLocations };
  }

  // Finds every canonical inventory key that COULD possibly be read by getInventoryCount
  // while evaluating this logic graph (every location rule, every area event/exit, and
  // everything reachable through macros - including every SECTOR_ENTRANCE_REQUIREMENTS
  // macro, conservatively, since which one applies depends on the seed's entrance mapping).
  // A canonical key that never shows up here can be added to or removed from inventory
  // without changing a single evaluateExpression result anywhere in the engine - the
  // atom that would have to read it simply doesn't exist. That makes it safe to treat
  // any placement of such an item as unconditionally prunable, with no resimulation
  // needed: this is a proof, not a heuristic, so it can't accidentally prune something
  // that actually matters.
  function collectReferencedItemKeys(rules, macros, world) {
    const referenced = new Set();
    const visitedMacros = new Set();
    let touchesHealth = false;

    function visitNode(node) {
      if (!node) return;
      if (node.type === "and" || node.type === "or") {
        visitNode(node.left);
        visitNode(node.right);
        return;
      }
      const classification = classifyAtom(node.value);
      if (classification.kind === "count_fn") {
        referenced.add(canonicalInventoryName(classification.item));
      } else if (classification.kind === "health") {
        touchesHealth = true;
      } else if (classification.kind === "dungeon_access") {
        Object.values(SECTOR_ENTRANCE_REQUIREMENTS).forEach((name) => visitMacro(normalize(name)));
      } else if (classification.kind === "item") {
        if (Object.prototype.hasOwnProperty.call(macros || {}, classification.key)) {
          visitMacro(classification.key);
        } else {
          referenced.add(canonicalInventoryName(classification.itemName));
        }
      }
      // "true"/"false"/"can_access"/"comparison"/"location"/"option_*" never read inventory
      // directly - "location" recurses into another location's rule, already covered since
      // every entry of `rules` is visited below.
    }

    function visitMacro(key) {
      if (visitedMacros.has(key)) return;
      visitedMacros.add(key);
      const macroText = macros?.[key];
      if (macroText !== undefined) visitNode(compileExpression(macroText));
    }

    Object.values(rules || {}).forEach((need) => visitNode(compileExpression(need)));
    if (world?.areas) {
      Object.values(world.areas).forEach((area) => {
        Object.values(area.events || {}).forEach((event) => visitNode(compileExpression(event.need)));
        Object.values(area.exits || {}).forEach((exit) => visitNode(compileExpression(exit.need)));
      });
    }

    if (touchesHealth) {
      referenced.add(canonicalInventoryName("Heart Container"));
      referenced.add(canonicalInventoryName("Piece of Heart"));
    }

    return referenced;
  }

  function calculate(input) {
    const placements = input.placements || [];
    // Shared for every calculateCore call this invocation makes (initial run, every
    // candidate-removal test, and the final result) - see getReachableLocationSet's
    // memoization comment for why this is safe across all of them.
    const reachabilityCache = new Map();
    const initial = calculateCore({ ...input, includeDependencies: false, reachabilityCache });
    if (input.includeDependencies === false) {
      initial.prunedPlacementIds = [];
      return initial;
    }
    const goalLocation = normalize("Ganon's Tower - Defeat Ganondorf");
    const goalIsReachable = Number.isInteger(initial.locationSpheres[goalLocation]);
    const baselineTargets = new Set(goalIsReachable
      ? [goalLocation]
      : placements
        .filter((placement) => Number.isInteger(initial.locationSpheres[normalize(placement.location)]))
        .map((placement) => normalize(placement.location)));
    const duplicateCounts = new Map();
    placements.forEach((placement) => {
      const itemKey = getInventoryItemKey(placement.item, placement.location);
      duplicateCounts.set(itemKey, (duplicateCounts.get(itemKey) || 0) + 1);
    });
    const referencedItemKeys = collectReferencedItemKeys(
      input.rules,
      getSeedMacros(input.macros, input.world, input.options, input.chartMappings),
      input.world
    );

    let activePlacements = [...placements];
    const prunedPlacementIds = new Set();
    const candidates = placements
      .filter((placement) => !placement.fromHint && Number.isInteger(initial.placementSpheres[placement.id]))
      .filter((placement) => {
        const itemKey = getInventoryItemKey(placement.item, placement.location);
        if (/(?:small|big|boss) key$/.test(itemKey) || normalize(placement.item) === "game beatable") return false;
        // Picto Box is deliberately not in this list. The randomizer's
        // pareDownPlaythrough (Search.cpp) walks its spheres forward, drops any
        // location whose item can be taken away with the game still beatable,
        // then recomputes the spheres from the survivors - so with two copies
        // the *earlier* one is dropped and everything it unlocked shifts to
        // after the later one. Excluding Picto Box from pruning kept the early
        // copy and put Pompie & Vera's Shield in sphere 1 where the spoiler log
        // says 6.
        //
        // Sword and Bow stay excluded: each of their stages is normally
        // required, so there is nothing to prune, and leaving them out avoids
        // disturbing the stage each card displays.
        if (["progressive sword", "progressive bow"].includes(itemKey)) return false;
        if (itemKey === "progressive shield" && Boolean(getOptionValue(input.options || {}, "Jalhalla Required").value)) return false;
        return goalIsReachable || (duplicateCounts.get(itemKey) || 0) > 1;
      })
      .sort((first, second) => initial.placementSpheres[first.id] - initial.placementSpheres[second.id]);

    candidates.forEach((candidate) => {
      const itemKey = getInventoryItemKey(candidate.item, candidate.location);
      if (!goalIsReachable) {
        const remainingCopies = activePlacements.filter((placement) => (
          placement.id !== candidate.id && getInventoryItemKey(placement.item, placement.location) === itemKey
        ));
        if (!remainingCopies.length) return;
      }

      if (!referencedItemKeys.has(itemKey)) {
        // No rule/event/exit anywhere ever reads this item - removing it is provably a
        // no-op for reachability, so skip the full resimulation entirely.
        activePlacements = activePlacements.filter((placement) => placement.id !== candidate.id);
        prunedPlacementIds.add(candidate.id);
        return;
      }

      const withoutCandidate = activePlacements.filter((placement) => placement.id !== candidate.id);
      const test = calculateCore({ ...input, placements: withoutCandidate, includeDependencies: false, reachabilityCache });
      if (![...baselineTargets].every((locationKey) => Number.isInteger(test.locationSpheres[locationKey]))) return;
      activePlacements = withoutCandidate;
      prunedPlacementIds.add(candidate.id);
    });

    const result = calculateCore({ ...input, placements: activePlacements, referencedItemKeys, reachabilityCache });
    prunedPlacementIds.forEach((placementId) => {
      const placement = placements.find((candidate) => candidate.id === placementId);
      if (!placement) return;
      const displaySphere = result.locationSpheres[normalize(placement.location)];
      if (Number.isInteger(displaySphere)) result.placementSpheres[placementId] = displaySphere;
    });
    // A location only the dropped copy could open still has an answer to "when
    // could I get here" - the one the run before pruning gave. Dropping the
    // early Picto Box is what the spoiler log does, and Pompie & Vera keeps the
    // sphere that follows from it; but Minenco's picture wants two boxes, and
    // reading "unknown" for a check you can walk to is worse than reading the
    // sphere you could first have walked there in. The playthrough's own
    // ordering is untouched: these are filled in, never moved.
    initial.sphereLocations.forEach((locations, sphereNumber) => {
      (locations || []).forEach((location) => {
        const locationKey = normalize(location);
        if (Number.isInteger(result.locationSpheres[locationKey])) return;
        result.locationSpheres[locationKey] = sphereNumber;
        if (!result.sphereLocations[sphereNumber]) result.sphereLocations[sphereNumber] = [];
        result.sphereLocations[sphereNumber].push(location);
      });
    });

    result.prunedPlacementIds = [...prunedPlacementIds];
    return result;
  }

  // ---------------------------------------------------------------------------
  // Requirement flattening
  //
  // Ported from the randomizer's own logic/flatten/ (flatten.cpp, bits.cpp, and
  // the essential half of simplify_algebraic.cpp's DNFToExpr). For every
  // location it produces a requirement expression built only from items - area
  // access and events are inlined away - which is what the randomizer's tracker
  // shows in its tooltip, and it is computed once when the logic loads rather
  // than per hover.
  //
  // Deliberately not ported: the kernel/co-kernel rectangle factoring upstream
  // uses to shorten the printed expression. Common-factor extraction is kept,
  // so output is correct and readable, just sometimes longer than upstream's.
  // ---------------------------------------------------------------------------

  function makeBitIndex() {
    const bits = new Map();
    const reverse = [];
    return {
      reverse,
      bitFor(atom) {
        const key = atom.kind === "health" ? "health::" + atom.count : normalize(atom.item) + "::" + atom.count;
        const existing = bits.get(key);
        if (existing !== undefined) return existing;
        const index = reverse.length;
        bits.set(key, index);
        reverse.push(atom);
        return index;
      }
    };
  }

  // Requirements the randomizer's tracker deliberately treats as always met
  // when it builds a tooltip. Sailing between islands is the only one - the
  // randomizer's developers confirmed as much - because otherwise every
  // location off the starting island would open with
  // "(Wind Waker and Wind's Requiem and Sail) or Swift Sail", which tells you
  // nothing. Boats_Sail and Swift_Sail appear nowhere else in the logic, so
  // assuming this macro removes every sail reference and nothing besides.
  //
  // Flattening only: the sphere calculation and the map's reachability still
  // require the sail for real.
  const FLATTEN_ASSUMED_MACROS = new Set(["can sail away"]);

  // A DNF is an OR of terms; each term is a bigint bitmask of required atoms
  // (an AND). The empty mask is the always-true term, and no terms at all is
  // false.
  const dnfTrue = () => ({ terms: [0n] });
  const dnfFalse = () => ({ terms: [] });
  const dnfIsTrue = (dnf) => dnf.terms.some((term) => term === 0n);
  const dnfIsFalse = (dnf) => dnf.terms.length === 0;
  const includedIn = (a, b) => (a | b) === b;

  /** Drops every term implied by another - a superset requires strictly more. */
  function dnfDedup(dnf) {
    const filtered = [];
    for (const candidate of dnf.terms) {
      let covered = false;
      for (let index = filtered.length - 1; index >= 0; index -= 1) {
        if (includedIn(filtered[index], candidate)) { covered = true; break; }
        if (includedIn(candidate, filtered[index])) {
          filtered[index] = filtered[filtered.length - 1];
          filtered.pop();
        }
      }
      if (!covered) filtered.push(candidate);
    }
    return { terms: filtered };
  }

  const dnfOr = (first, second) => ({ terms: [...first.terms, ...second.terms] });

  /** OR, plus whether `other` contributed anything not already implied. */
  function dnfOrUseful(current, other) {
    const added = [];
    for (const candidate of other.terms) {
      if (current.terms.some((existing) => includedIn(existing, candidate))) continue;
      added.push(candidate);
    }
    return { useful: added.length > 0, dnf: { terms: [...current.terms, ...added] } };
  }

  function dnfAnd(first, second) {
    const terms = [];
    for (const left of first.terms) {
      for (const right of second.terms) terms.push(left | right);
    }
    const combined = { terms };
    return terms.length > 500 ? dnfDedup(combined) : combined;
  }

  /** Every event and can_access area an expression can reach through macros. */
  function collectRemoteDependencies(node, context, out, macroStack) {
    if (!node) return;
    if (node.type === "and" || node.type === "or") {
      collectRemoteDependencies(node.left, context, out, macroStack);
      collectRemoteDependencies(node.right, context, out, macroStack);
      return;
    }
    const classification = classifyAtom(node.value);
    if (classification.kind === "can_access") { out.areas.add(classification.area); return; }
    if (classification.kind !== "item") return;
    if (context.eventKeys.has(classification.key)) { out.events.add(classification.key); return; }
    const macro = context.macros && context.macros[classification.key];
    if (macro && !macroStack.has(classification.key)) {
      const nextStack = new Set(macroStack);
      nextStack.add(classification.key);
      collectRemoteDependencies(compileExpression(macro), context, out, nextStack);
    }
  }

  /**
   * The flatten twin of evaluateNode: instead of a boolean it returns the DNF
   * of item requirements. Atom handling follows evaluateAtom's order so the two
   * can never disagree about what a rule means.
   */
  function evaluatePartial(node, search, macroStack) {
    if (!node) return dnfFalse();
    if (node.type === "and") return dnfAnd(evaluatePartial(node.left, search, macroStack), evaluatePartial(node.right, search, macroStack));
    if (node.type === "or") return dnfOr(evaluatePartial(node.left, search, macroStack), evaluatePartial(node.right, search, macroStack));

    const context = search.context;
    const classification = classifyAtom(node.value);

    if (classification.kind === "true") return dnfTrue();
    if (classification.kind === "false") return dnfFalse();
    if (classification.key && FLATTEN_ASSUMED_MACROS.has(classification.key)) return dnfTrue();
    if (classification.kind === "can_access") return search.areaExprs.get(classification.area) || dnfFalse();

    // A count requirement implies every lesser count of the same item, so the
    // lesser bits go in too - that is what lets dedup cancel weaker terms.
    if (classification.kind === "count_fn") {
      let mask = 0n;
      for (let copies = 1; copies <= classification.count; copies += 1) {
        mask |= 1n << BigInt(search.bitIndex.bitFor({ kind: "item", item: classification.item, count: copies }));
      }
      return { terms: [mask] };
    }

    if (classification.kind === "health") {
      return { terms: [1n << BigInt(search.bitIndex.bitFor({ kind: "health", count: classification.count }))] };
    }

    if (context.eventKeys.has(classification.key)) return search.eventExprs.get(classification.key) || dnfFalse();

    // A seed's options are fixed, so they collapse to true or false here rather
    // than surviving into the tooltip.
    if (classification.kind === "comparison" || classification.kind === "option_enabled_disabled"
      || classification.kind === "option_is" || classification.kind === "option_contains") {
      const staticContext = { ...context, inventory: {}, events: new Set(), accessibleAreas: new Set() };
      return evaluateAtom(node.value, staticContext, new Set()) ? dnfTrue() : dnfFalse();
    }

    if (classification.kind === "location") {
      const rule = context.rules && context.rules[classification.locationKey];
      const guard = "loc:" + classification.locationKey;
      if (!rule || macroStack.has(guard)) return dnfFalse();
      const nextStack = new Set(macroStack);
      nextStack.add(guard);
      return evaluatePartial(compileExpression(rule), search, nextStack);
    }

    if (classification.kind === "dungeon_access") {
      const randomized = Boolean(getOptionValue(context.options || {}, "randomize_dungeon_entrances").value);
      const mappedSector = context.entranceMappings && context.entranceMappings[classification.dungeonName];
      if (randomized && !mappedSector) return dnfFalse();
      const sector = mappedSector || VANILLA_DUNGEON_SECTORS[classification.dungeonName];
      const requirementName = SECTOR_ENTRANCE_REQUIREMENTS[normalize(sector)];
      const requirement = requirementName && context.macros && context.macros[normalize(requirementName)];
      return requirement ? evaluatePartial(compileExpression(requirement), search, macroStack) : dnfFalse();
    }

    const macro = context.macros && context.macros[classification.key];
    if (macro && !macroStack.has(classification.key)) {
      const nextStack = new Set(macroStack);
      nextStack.add(classification.key);
      return evaluatePartial(compileExpression(macro), search, nextStack);
    }

    return { terms: [1n << BigInt(search.bitIndex.bitFor({ kind: "item", item: classification.itemName, count: classification.count }))] };
  }

  // --- Algebraic factoring (simplify_algebraic.cpp) -------------------------
  //
  // A flattened requirement in plain DNF lists every winning combination on its
  // own line, which for a mini-boss runs to ten. Upstream factors out shared
  // structure first, turning that into three decisions plus a fallback. This is
  // the kernel/co-kernel rectangle method it uses: find sub-expressions that
  // divide the whole cleanly, take the division saving the most literals, and
  // recurse on the pieces.
  //
  // Cubes are the same bigint masks the DNF already uses, so everything
  // BitVector does upstream is a bitwise operation here.

  const popcount = (mask) => {
    let count = 0;
    let rest = mask;
    while (rest) {
      rest &= rest - 1n;
      count += 1;
    }
    return count;
  };

  const cubeBits = (mask, total) => {
    const bits = [];
    for (let bit = 0; bit < total; bit += 1) if ((mask >> BigInt(bit)) & 1n) bits.push(bit);
    return bits;
  };

  /** expr = quotient * divisor + remainder, over cubes. */
  function algebraicDivision(expr, divisor) {
    let quot = null;
    for (const divCube of divisor) {
      const divisible = expr.filter((cube) => (cube & divCube) === divCube).map((cube) => cube & ~divCube);
      if (!divisible.length) return { quot: [], remainder: expr.slice() };
      quot = quot === null ? divisible : quot.filter((cube) => divisible.includes(cube));
    }
    quot = quot ?? [];

    const product = new Set();
    quot.forEach((q) => divisor.forEach((d) => product.add(q | d)));
    const remainder = expr.filter((cube) => ![...product].some((term) => includedIn(term, cube)));
    return { quot, remainder };
  }

  /**
   * Every co-kernel of the expression paired with the kernel it divides out. A
   * co-kernel is a cube the whole expression divides by cleanly, leaving
   * something with no common factor of its own.
   */
  function findKernels(cubes, variables, coKernelPath, seenCoKernels, minIdx, budget) {
    const kernels = [];
    for (let idx = 0; idx < variables.length; idx += 1) {
      if (idx < minIdx || budget.spent > budget.limit) continue;
      const mask = 1n << BigInt(variables[idx]);
      const sharing = cubes.filter((cube) => (cube & mask) !== 0n);
      if (sharing.length < 2) continue;

      budget.spent += 1;
      let coKernel = sharing[0];
      sharing.forEach((cube) => {
        coKernel &= cube;
      });
      const divided = algebraicDivision(cubes, [coKernel]);
      findKernels(divided.quot, variables, coKernelPath | coKernel, seenCoKernels, idx + 1, budget).forEach((sub) => {
        if (seenCoKernels.includes(sub.coKernel)) return;
        seenCoKernels.push(sub.coKernel);
        kernels.push(sub);
      });
    }

    // A cube-free expression is its own kernel, with the trivial co-kernel 1.
    if (!seenCoKernels.includes(coKernelPath)) kernels.push({ kernel: cubes, coKernel: coKernelPath });
    return kernels;
  }

  /** Prime rectangles of the kernel/co-kernel matrix (Rudell). */
  function genRectangles(allRows, allCols, matrix, callback) {
    allRows.forEach((row) => {
      const ones = allCols.filter((col) => matrix[row][col]);
      if (!ones.length) return;
      const covered = allRows.some((other) => other !== row && ones.every((col) => matrix[other][col]));
      if (!covered) callback([row], ones);
    });

    allCols.forEach((col) => {
      const ones = allRows.filter((row) => matrix[row][col]);
      if (!ones.length) return;
      const covered = allCols.some((other) => other !== col && ones.every((row) => matrix[row][other]));
      if (!covered) callback(ones, [col]);
    });

    genRectanglesRecursive(allRows, allCols, matrix, 0, [], callback);
  }

  function genRectanglesRecursive(allRows, allCols, matrix, index, rectCols, callback) {
    for (const col of allCols) {
      if (col < index) continue;
      const onesInCol = allRows.filter((row) => matrix[row][col]).length;
      if (onesInCol < 2) continue;

      const submatrix = matrix.map((row, rowIdx) => (matrix[rowIdx][col] ? row.slice() : row.map(() => 0)));
      const rectRows = allRows.filter((row) => matrix[row][col]);
      const nextCols = rectCols.slice();

      let prune = false;
      for (const other of allCols) {
        if (allRows.filter((row) => submatrix[row][other]).length !== onesInCol) continue;
        // A full column before the starting index means this submatrix was
        // already covered when that column was processed (Rudell).
        if (other < col) {
          prune = true;
          break;
        }
        nextCols.push(other);
        allRows.forEach((row) => {
          submatrix[row][other] = 0;
        });
      }

      if (prune) continue;
      callback(rectRows, nextCols);
      genRectanglesRecursive(allRows, allCols, submatrix, col, nextCols, callback);
    }
  }

  /** DNF back to a readable AND/OR tree - DNFToExpr, factoring included. */
  function dnfToRequirement(bitIndex, dnf) {
    if (dnfIsFalse(dnf)) return { type: "impossible" };
    if (dnfIsTrue(dnf)) return { type: "nothing" };

    const total = bitIndex.reverse.length;
    let expr = dnfDedup(dnf).terms.slice();

    // "Wallet x1 and Wallet x2" reads badly - keep only the strongest count of
    // each item in a term. Done before factoring, or the weaker count gets
    // pulled out as a common factor and the result reads as nonsense.
    expr = expr.map((cube) => {
      let stripped = cube;
      cubeBits(cube, total).forEach((bit) => {
        const atom = bitIndex.reverse[bit];
        if (atom.kind !== "item" || atom.count <= 1) return;
        for (let lesser = 1; lesser < atom.count; lesser += 1) {
          stripped &= ~(1n << BigInt(bitIndex.bitFor({ kind: "item", item: atom.item, count: lesser })));
        }
      });
      return stripped;
    });

    let commonFactors = expr[0];
    expr.forEach((cube) => {
      commonFactors &= cube;
    });
    expr = expr.map((cube) => cube & ~commonFactors);

    const toAtoms = (mask) => cubeBits(mask, total).map((bit) => bitIndex.reverse[bit]).map((atom) => (
      atom.kind === "health" ? { type: "health", count: atom.count } : { type: "item", item: atom.item, count: atom.count }
    ));
    const andOf = (args) => (args.length === 1 ? args[0] : { type: "and", args });
    const commonArgs = toAtoms(commonFactors);

    const variables = [...new Set(expr.flatMap((cube) => cubeBits(cube, total)))];
    if (!variables.length) return commonArgs.length ? andOf(commonArgs) : { type: "nothing" };

    const fallback = () => {
      const alternatives = expr.filter((cube) => cube !== 0n).map((cube) => andOf(toAtoms(cube)));
      if (!alternatives.length) return commonArgs.length ? andOf(commonArgs) : { type: "nothing" };
      const disjunction = alternatives.length === 1 ? alternatives[0] : { type: "or", args: alternatives };
      return commonArgs.length ? andOf([...commonArgs, disjunction]) : disjunction;
    };

    // The kernel search is exponential in the variable count. Real
    // requirements sit far below this; the guard only means a pathological one
    // costs a longer tooltip instead of a stalled load.
    if (expr.length > 40 || variables.length > 24) return fallback();

    const budget = { spent: 0, limit: 4000 };
    const kernels = findKernels(expr, variables, 0n, [], 0, budget).filter((entry) => entry.coKernel !== 0n);

    const columns = [];
    kernels.forEach((entry) => entry.kernel.forEach((cube) => {
      if (!columns.includes(cube)) columns.push(cube);
    }));
    if (!kernels.length || !columns.length) return fallback();

    const matrix = kernels.map((entry) => columns.map((cube) => (entry.kernel.includes(cube) ? 1 : 0)));
    const allRows = kernels.map((unused, index) => index);
    const allCols = columns.map((unused, index) => index);

    // Optimise for literals saved, which stands in well for a shorter read.
    const literalsSaved = (rectRows, rectCols) => {
      let weight = 0;
      rectRows.forEach((row) => rectCols.forEach((col) => {
        if (matrix[row][col]) weight += popcount(kernels[row].coKernel | columns[col]);
      }));
      rectRows.forEach((row) => {
        weight -= popcount(kernels[row].coKernel) + 1;
      });
      rectCols.forEach((col) => {
        weight -= popcount(columns[col]);
      });
      return weight;
    };

    let bestCols = null;
    let bestValue = -Infinity;
    genRectangles(allRows, allCols, matrix, (rectRows, rectCols) => {
      const value = literalsSaved(rectRows, rectCols);
      if (value > bestValue) {
        bestValue = value;
        bestCols = rectCols;
      }
    });
    if (!bestCols || !bestCols.length) return fallback();

    const divisor = bestCols.map((col) => columns[col]);
    const divided = algebraicDivision(expr, divisor);
    if (!divided.quot.length) return fallback();

    const product = {
      type: "and",
      args: [dnfToRequirement(bitIndex, { terms: divided.quot }), dnfToRequirement(bitIndex, { terms: divisor })]
    };
    const sum = divided.remainder.length
      ? { type: "or", args: [product, dnfToRequirement(bitIndex, { terms: divided.remainder })] }
      : product;

    return commonArgs.length ? andOf([...commonArgs, sum]) : sum;
  }

  /**
   * The three-stage flatten: a fixpoint over area access and events, then one
   * OR per location over every way to reach it, then simplification.
   */
  function flattenRequirements(input) {
    const world = input.world;
    if (!world || !world.areas) return {};

    const eventKeys = new Set();
    Object.values(world.areas).forEach((area) => {
      Object.values(area.events || {}).forEach((event) => eventKeys.add(normalize(event.name)));
    });

    const context = {
      world,
      rules: input.rules || {},
      macros: getSeedMacros(input.macros, world, input.options, input.chartMappings),
      options: input.options || {},
      entranceMappings: input.entranceMappings || {},
      entranceConnections: input.entranceConnections || {},
      chartMappings: input.chartMappings || {},
      startingIsland: input.startingIsland || "",
      eventKeys
    };
    context.entranceState = buildEntranceConnections(context);

    const search = { context, bitIndex: makeBitIndex(), areaExprs: new Map(), eventExprs: new Map() };

    // Only re-check an exit or event when something it depends on moved: its
    // own area, or an event/area it names through can_access. Without this the
    // fixpoint re-evaluates the whole world every round.
    const things = [];
    Object.entries(world.areas).forEach(([areaKey, area]) => {
      Object.values(area.exits || {}).forEach((exit) => things.push({ kind: "exit", areaKey, area, entry: exit }));
      Object.values(area.events || {}).forEach((event) => things.push({ kind: "event", areaKey, area, entry: event }));
    });
    const dependencies = new Map();
    things.forEach((thing) => {
      const out = { events: new Set(), areas: new Set() };
      collectRemoteDependencies(compileExpression(thing.entry.need), context, out, new Set());
      dependencies.set(thing, out);
    });

    const rootKey = normalize(world.startArea || "Root");
    search.areaExprs.set(rootKey, dnfTrue());
    (input.additionalStartAreas || []).map(normalize).forEach((areaKey) => {
      if (world.areas[areaKey]) search.areaExprs.set(areaKey, dnfTrue());
    });

    let recentAreas = new Set(search.areaExprs.keys());
    let recentEvents = new Set();
    let rounds = 0;

    while ((recentAreas.size || recentEvents.size) && rounds < 500) {
      rounds += 1;
      const nextAreas = new Set();
      const nextEvents = new Set();

      things.forEach((thing) => {
        const parentExpr = search.areaExprs.get(thing.areaKey);
        if (!parentExpr) return;
        const remote = dependencies.get(thing);
        const touched = recentAreas.has(thing.areaKey)
          || [...remote.events].some((key) => recentEvents.has(key))
          || [...remote.areas].some((key) => recentAreas.has(key));
        if (!touched) return;

        const partial = dnfAnd(parentExpr, evaluatePartial(compileExpression(thing.entry.need), search, new Set()));
        if (dnfIsFalse(partial)) return;

        if (thing.kind === "exit") {
          const targetKey = normalize(resolveExitTarget(thing.area, thing.entry.name, context));
          if (!targetKey || !world.areas[targetKey]) return;
          const current = search.areaExprs.get(targetKey) || dnfFalse();
          const merged = dnfOrUseful(current, partial);
          if (!merged.useful) return;
          search.areaExprs.set(targetKey, dnfDedup(merged.dnf));
          nextAreas.add(targetKey);
        } else {
          const eventKey = normalize(thing.entry.name);
          const current = search.eventExprs.get(eventKey) || dnfFalse();
          const merged = dnfOrUseful(current, partial);
          if (!merged.useful) return;
          search.eventExprs.set(eventKey, dnfDedup(merged.dnf));
          nextEvents.add(eventKey);
        }
      });

      recentAreas = nextAreas;
      recentEvents = nextEvents;
    }

    // One OR per location over every area that hosts it.
    const perLocation = new Map();
    Object.entries(world.areas).forEach(([areaKey, area]) => {
      (area.locations || []).forEach((entry) => {
        const key = normalize(entry.name);
        if (!perLocation.has(key)) perLocation.set(key, dnfFalse());
        const areaExpr = search.areaExprs.get(areaKey);
        if (!areaExpr) return;
        const combined = dnfAnd(areaExpr, evaluatePartial(compileExpression(entry.need), search, new Set()));
        perLocation.set(key, dnfOr(perLocation.get(key), combined));
      });
    });

    // Entrances get the same treatment, keyed by "Parent -> Connected": what
    // it takes to stand at that door and open it, which is reaching its area
    // and satisfying the exit's own condition. The tracker's entrance lists
    // show this the way the location lists show a location's requirement.
    Object.entries(world.areas).forEach(([areaKey, area]) => {
      // An area with no expression was never reached; its doors still get an
      // entry so they report "impossible" rather than looking like the logic
      // failed to load.
      const areaExpr = search.areaExprs.get(areaKey) || dnfFalse();
      Object.values(area.exits || {}).forEach((exit) => {
        const key = normalize(`${area.name} -> ${exit.name}`);
        const combined = dnfAnd(areaExpr, evaluatePartial(compileExpression(exit.need), search, new Set()));
        perLocation.set(key, dnfOr(perLocation.get(key) || dnfFalse(), combined));
      });
    });

    const requirements = {};
    perLocation.forEach((dnf, key) => {
      requirements[key] = dnfToRequirement(search.bitIndex, dnfDedup(dnf));
    });
    return requirements;
  }

  global.WWRSphereEngine = {
    normalize,
    parseLogicData,
    parseConfig,
    getReachableLocations,
    getAccessibleAreas,
    getTraversableExits,
    calculate,
    // Exposed for the location requirement tooltip (logic/requirement-text.ts)
    // so it parses and classifies expressions with exactly the same code the
    // logic itself uses - a display-only reimplementation would be free to
    // silently disagree with the engine about what a rule means.
    compileExpression,
    classifyAtom,
    flattenRequirements,
    // Exposed for the entrance tracker (logic/entrances.ts) for the same
    // reason: which entrance types a seed shuffles is a logic question, and a
    // second copy of the rule in the UI would be free to disagree with the one
    // the reachability pass actually uses.
    isShuffleTypeEnabled,
    // Which sector each dungeon sits on before any shuffling - the old
    // dungeon-list model records "this dungeon was found on that sector", and
    // naming the door involved means knowing whose door normally lives there.
    VANILLA_DUNGEON_SECTORS
  };
}(typeof window !== "undefined" ? window : globalThis));
