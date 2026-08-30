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

  function buildEntranceConnections(context) {
    const world = context.world;
    const connections = {};
    const disconnected = new Set();
    if (!world?.shuffleEntrances?.length) return { connections, disconnected };

    world.shuffleEntrances.forEach((entry) => {
      if (!isShuffleTypeEnabled(entry.type, context.options)) return;
      disconnected.add(normalize(`${entry.forward.parent} -> ${entry.forward.connected}`));
      if (!getOptionValue(context.options || {}, "decouple_entrances").value && entry.reverse) {
        disconnected.add(normalize(`${entry.reverse.parent} -> ${entry.reverse.connected}`));
      }
    });

    Object.entries(context.entranceConnections || {}).forEach(([sourceName, targetName]) => {
      const source = world.shuffleEntranceByEdge?.[normalize(sourceName)];
      const target = world.shuffleEntranceByEdge?.[normalize(targetName)];
      const isForward = (match) => match?.entry && normalize(`${match.side.parent} -> ${match.side.connected}`)
        === normalize(`${match.entry.forward.parent} -> ${match.entry.forward.connected}`);
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
    const events = seed?.events ? new Set(seed.events) : new Set();
    const entranceState = buildEntranceConnections({ ...contextBase, world });
    const context = { ...contextBase, world, accessibleAreas, events, entranceState };
    let eventChanged = true;
    let passes = 0;

    while (eventChanged && passes < 1000) {
      eventChanged = false;
      passes += 1;
      const pendingAreas = [...accessibleAreas];
      const scannedAreas = new Set();

      while (pendingAreas.length) {
        const areaKey = pendingAreas.shift();
        if (scannedAreas.has(areaKey)) continue;
        scannedAreas.add(areaKey);
        const area = world.areas[areaKey];
        if (!area) continue;

        Object.values(area.events).forEach((event) => {
          const eventKey = normalize(event.name);
          if (!events.has(eventKey) && evaluateExpression(event.need, context)) {
            events.add(eventKey);
            eventChanged = true;
          }
        });

        Object.values(area.exits).forEach((exit) => {
          if (!evaluateExpression(exit.need, context)) return;
          const target = resolveExitTarget(area, exit.name, context);
          const targetKey = normalize(target);
          if (targetKey && world.areas[targetKey] && !accessibleAreas.has(targetKey)) {
            accessibleAreas.add(targetKey);
            pendingAreas.push(targetKey);
          }
        });
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

  function getReachableLocations({ locations, rules, macros, world, items, options, entranceMappings, entranceConnections, chartMappings, additionalStartAreas, startingIsland }) {
    const inventory = {};
    (items || []).forEach((item) => addInventoryItem(inventory, item, ""));
    const contextBase = { rules, macros: getSeedMacros(macros, world, options, chartMappings), options, entranceMappings, entranceConnections, chartMappings, additionalStartAreas, startingIsland, world };
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

  function calculateCore({ locations, rules, macros, world, placements, startingGear, options, entranceMappings, entranceConnections, chartMappings, includeDependencies = true, referencedItemKeys, startingIsland, reachabilityCache }) {
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
        if (["progressive sword", "progressive bow", "progressive picto box"].includes(itemKey)) return false;
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
    result.prunedPlacementIds = [...prunedPlacementIds];
    return result;
  }

  global.WWRSphereEngine = {
    normalize,
    parseLogicData,
    parseConfig,
    getReachableLocations,
    calculate,
    // Exposed for the location requirement tooltip (logic/requirement-text.ts)
    // so it parses and classifies expressions with exactly the same code the
    // logic itself uses - a display-only reimplementation would be free to
    // silently disagree with the engine about what a rule means.
    compileExpression,
    classifyAtom
  };
}(typeof window !== "undefined" ? window : self));
