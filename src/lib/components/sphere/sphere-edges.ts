// SVG dependency lines between sphere-board cards, plus the hover "chain
// focus" that dims everything outside the hovered card's dependency chain.
//
// Ported from dev/app/app.js (drawSphereEdges, applySphereChainFocus). The
// stylesheet for these lines shipped with the original CSS during the port but
// nothing ever drew them, so .sphere-edges sat styled-but-empty.
//
// Both functions read the graph straight off the DOM - every card carries its
// own `data-node-id` and comma-separated `data-dependencies` - exactly as the
// original did. That keeps the drawing independent of which column a card
// happens to live in, and means a card type only has to publish those two
// attributes to join the graph.
const SVG_NS = "http://www.w3.org/2000/svg";

function collectNodes(canvas: HTMLElement): Map<string, HTMLElement> {
  return new Map(
    [...canvas.querySelectorAll<HTMLElement>("[data-node-id]")].map((node) => [node.dataset.nodeId!, node])
  );
}

/** parents/children adjacency, filtered to nodes actually on the board. */
function buildGraph(nodes: Map<string, HTMLElement>) {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>([...nodes.keys()].map((id) => [id, [] as string[]]));
  nodes.forEach((node, targetId) => {
    const dependencies = (node.dataset.dependencies?.split(",") ?? []).filter((id) => nodes.has(id));
    parents.set(targetId, dependencies);
    dependencies.forEach((sourceId) => children.get(sourceId)!.push(targetId));
  });
  return { parents, children };
}

const edgeKey = (sourceId: string, targetId: string) => `${sourceId}\n${targetId}`;

/**
 * Redraws every edge. `zoom` is the CSS zoom on the column container: node
 * rects come back already scaled by it, while the container's scrollWidth /
 * scrollHeight are in unscaled layout pixels, so dividing puts both into the
 * same space as the SVG's own viewBox.
 */
export function drawSphereEdges(canvas: HTMLElement, edges: SVGSVGElement, zoom = 1): void {
  const canvasRect = canvas.getBoundingClientRect();
  const width = Math.max(canvas.scrollWidth, canvas.clientWidth);
  const height = Math.max(canvas.scrollHeight, canvas.clientHeight);
  edges.setAttribute("width", String(width));
  edges.setAttribute("height", String(height));
  edges.setAttribute("viewBox", `0 0 ${width} ${height}`);
  edges.replaceChildren();

  const nodes = collectNodes(canvas);
  const scale = zoom || 1;
  nodes.forEach((target, targetId) => {
    const dependencies = (target.dataset.dependencies?.split(",") ?? []).filter(Boolean);
    dependencies.forEach((sourceId) => {
      const source = nodes.get(sourceId);
      if (!source) return;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      // Source's right edge to the target's left edge, both at mid-height.
      const startX = (sourceRect.right - canvasRect.left) / scale;
      const startY = (sourceRect.top + sourceRect.height / 2 - canvasRect.top) / scale;
      const endX = (targetRect.left - canvasRect.left) / scale;
      const endY = (targetRect.top + targetRect.height / 2 - canvasRect.top) / scale;
      const bend = Math.max(20, (endX - startX) * 0.45);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`);
      path.dataset.source = sourceId;
      path.dataset.target = targetId;
      edges.appendChild(path);
    });
  });

  markPathHintEdges(nodes, canvas, edges);
}

/**
 * Paints the chain from each path hint's source cards up to the boss card
 * purple, so "this area is on the path to X" is visible without hovering.
 *
 * Ported from markSpherePathHintEdges (dev/app/app.js:4434). Walks up from
 * the path card to collect its ancestors, then forward from each source
 * through those ancestors - so only edges that actually lie between the
 * source and the boss are painted, not the source's whole subtree.
 */
function markPathHintEdges(nodes: Map<string, HTMLElement>, canvas: HTMLElement, edges: SVGSVGElement): void {
  nodes.forEach((node) => {
    node.classList.remove("path-chain-location");
    delete node.dataset.pathTargetIds;
  });

  const { parents, children } = buildGraph(nodes);
  const pathEdges = new Set<string>();
  const pathNodeIds = new Set<string>();

  const addPathTarget = (pathNodeId: string, targetId: string) => {
    const node = nodes.get(pathNodeId);
    if (!node) return;
    // An own-dungeon key never came from the hinted area, so it is not part
    // of the path being described.
    if (node.classList.contains("sphere-placement") && isOwnDungeonKeyItem(node.dataset.pathItem ?? "")) return;
    const targetIds = new Set((node.dataset.pathTargetIds ?? "").split(",").filter(Boolean));
    targetIds.add(targetId);
    node.dataset.pathTargetIds = [...targetIds].join(",");
    pathNodeIds.add(pathNodeId);
  };

  canvas.querySelectorAll<HTMLElement>(".sphere-path-prediction[data-path-source-ids]").forEach((pathCard) => {
    const targetId = pathCard.dataset.nodeId;
    if (!targetId) return;
    const sourceIds = (pathCard.dataset.pathSourceIds ?? "").split(",").filter((id) => nodes.has(id));
    if (!sourceIds.length) return;

    const ancestors = new Set([targetId]);
    const ancestorQueue = [targetId];
    while (ancestorQueue.length) {
      const currentId = ancestorQueue.pop()!;
      (parents.get(currentId) ?? []).forEach((sourceId) => {
        if (ancestors.has(sourceId)) return;
        ancestors.add(sourceId);
        ancestorQueue.push(sourceId);
      });
    }

    const cardPathNodeIds = new Set([targetId]);
    sourceIds.forEach((sourceId) => {
      if (!ancestors.has(sourceId)) return;
      cardPathNodeIds.add(sourceId);
      const visited = new Set([sourceId]);
      const pending = [sourceId];
      while (pending.length) {
        const currentId = pending.shift()!;
        (children.get(currentId) ?? []).forEach((childId) => {
          if (!ancestors.has(childId)) return;
          pathEdges.add(edgeKey(currentId, childId));
          cardPathNodeIds.add(currentId);
          cardPathNodeIds.add(childId);
          if (visited.has(childId)) return;
          visited.add(childId);
          pending.push(childId);
        });
      }
    });
    cardPathNodeIds.forEach((pathNodeId) => addPathTarget(pathNodeId, targetId));
  });

  // Purple edges are re-appended so they paint over the grey ones.
  const purple: SVGPathElement[] = [];
  edges.querySelectorAll<SVGPathElement>("path").forEach((path) => {
    const isPurple = pathEdges.has(edgeKey(path.dataset.source ?? "", path.dataset.target ?? ""));
    path.classList.toggle("path-hint-edge", isPurple);
    if (isPurple) purple.push(path);
  });
  pathNodeIds.forEach((nodeId) => nodes.get(nodeId)?.classList.add("path-chain-location"));
  purple.forEach((path) => edges.appendChild(path));
}

/** Mirrors isOwnDungeonKeyForPath without importing the sphere logic here. */
function isOwnDungeonKeyItem(item: string): boolean {
  return /(small key|big key|boss key)/i.test(item);
}

/**
 * Hovering a card lights its dependency chain and dims everything else.
 *
 * Upwards the chain is every ancestor - what this card needed. Downwards it is
 * only descendants that lead to a location you have actually marked, so the
 * fan-out of "everything this could eventually unlock" stays out of it.
 */
export function applySphereChainFocus(canvas: HTMLElement | null, edges: SVGSVGElement | null, nodeId: string): void {
  if (!canvas || !edges) return;
  const nodes = collectNodes(canvas);
  const paths = [...edges.querySelectorAll<SVGPathElement>("path")];
  // The dimming rules are written against .sphere-canvas, while the graph is
  // measured against the inner zoomed .sphere-columns - so the flag goes on
  // the ancestor the stylesheet names.
  const focusRoot = canvas.closest<HTMLElement>(".sphere-canvas") ?? canvas;

  if (!nodeId || !nodes.has(nodeId)) {
    focusRoot.classList.remove("sphere-chain-focus");
    nodes.forEach((node) => node.classList.remove("sphere-chain-dimmed", "suppress-path-tint"));
    paths.forEach((path) => path.classList.remove("highlighted", "sphere-chain-dimmed"));
    return;
  }

  const { parents, children } = buildGraph(nodes);
  const chain = new Set([nodeId]);
  const highlightedEdges = new Set<string>();

  const pending = [nodeId];
  while (pending.length) {
    const currentId = pending.pop()!;
    (parents.get(currentId) ?? []).forEach((parentId) => {
      highlightedEdges.add(edgeKey(parentId, currentId));
      if (chain.has(parentId)) return;
      chain.add(parentId);
      pending.push(parentId);
    });
  }

  const descendantMemo = new Map<string, boolean>();
  const collectMarkedDescendants = (currentId: string, visiting = new Set<string>()): boolean => {
    if (descendantMemo.has(currentId)) return descendantMemo.get(currentId)!;
    if (visiting.has(currentId)) return false;
    const nextVisiting = new Set(visiting).add(currentId);
    let reachesMarkedLocation = false;
    (children.get(currentId) ?? []).forEach((childId) => {
      const child = nodes.get(childId);
      const childIsMarkedLocation = child?.dataset.markedLocation === "true";
      const childReaches = collectMarkedDescendants(childId, nextVisiting);
      if (!childIsMarkedLocation && !childReaches) return;
      chain.add(childId);
      highlightedEdges.add(edgeKey(currentId, childId));
      reachesMarkedLocation = true;
    });
    descendantMemo.set(currentId, reachesMarkedLocation);
    return reachesMarkedLocation;
  };
  collectMarkedDescendants(nodeId);

  focusRoot.classList.add("sphere-chain-focus");
  // Focusing one boss card mutes the purple tint on cards that belong to a
  // *different* path hint, so the highlighted chain reads as one path.
  const focusingBoss = nodes.get(nodeId)?.classList.contains("sphere-path-prediction") ?? false;
  nodes.forEach((node, id) => {
    node.classList.toggle("sphere-chain-dimmed", !chain.has(id));
    const pathTargetIds = (node.dataset.pathTargetIds ?? "").split(",").filter(Boolean);
    node.classList.toggle(
      "suppress-path-tint",
      focusingBoss && node.classList.contains("path-chain-location") && !pathTargetIds.includes(nodeId)
    );
  });
  paths.forEach((path) => {
    const inChain = highlightedEdges.has(edgeKey(path.dataset.source ?? "", path.dataset.target ?? ""));
    path.classList.toggle("highlighted", inChain);
    path.classList.toggle("sphere-chain-dimmed", !inChain);
  });
}
