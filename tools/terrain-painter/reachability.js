// Pure staged-reachability algorithm behind the terrain painter's "Check
// Map" feature - no DOM/canvas/window dependency, so it can be unit tested
// directly (see tests/terrainPainterReachability.test.js) and imported by
// painter.js for the real UI.

// Which terrain kinds each tool dungeon's reward unlocks, applied in this
// order (matches Timothy's own map design: axe before pick before
// canoe/boat, each one only reachable using what came before).
export const TOOL_UNLOCK_KINDS = {
  axe: ['thicket', 'thicketCache'],
  pick: ['mountain', 'mountainCache'],
  canoe: ['water'],
};

export function floodFillReachable(width, height, start, isPassable) {
  const reached = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const key = `${nx},${ny}`;
      if (reached.has(key)) continue;
      if (!isPassable(nx, ny)) continue;
      reached.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return reached;
}

// Tiles just outside a reached region that are still blocked - i.e. exactly
// where a player standing at the edge of what they can reach hits a wall.
export function computeFrontier(width, height, reached, isPassable) {
  const frontier = new Set();
  for (const key of reached) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nkey = `${nx},${ny}`;
      if (reached.has(nkey) || isPassable(nx, ny)) continue;
      frontier.add(nkey);
    }
  }
  return frontier;
}

// The progression check itself. `dungeons` is an UNORDERED list of
// { id, label, pos: {x,y}|null, unlocks: string[] } (a dungeon that doesn't
// gate any terrain - the dragon dungeon, the portal dungeon - just passes
// `unlocks: []` and is treated as a plain reachability target). This is a
// fixed-point/iterative-unlock algorithm, not a search over orderings:
// starting from `unlockedKinds = toollessKinds`, repeatedly scan every
// not-yet-unlocked dungeon and unlock any whose entrance has become
// reachable, adding its `unlocks` kinds and re-flooding: Stop when a full
// pass unlocks nothing new. Whatever order the dungeons happen to unlock in
// during that process is a real, playable order - so this reports "sound"
// whenever every dungeon eventually unlocks, regardless of which one went
// first. A dungeon that's still locked once the pass stabilizes is a genuine
// deadlock (or simply hasn't been placed on the map yet - `pos` is null) and
// is reported by id/label, not by a numbered "stage".
//
// isPassable(x, y, unlockedKinds: Set<string>) is caller-defined - it looks
// up the tile kind, applies entrance-marker/sealed-edge overrides, etc.
export function checkProgression({ width, height, town, isPassable, toollessKinds, dungeons }) {
  const unlockedKinds = new Set(toollessKinds);
  const unlocked = new Set();
  let reached = floodFillReachable(width, height, town, (x, y) => isPassable(x, y, unlockedKinds));

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const dungeon of dungeons) {
      if (unlocked.has(dungeon.id)) continue;
      const key = dungeon.pos ? `${dungeon.pos.x},${dungeon.pos.y}` : null;
      if (!key || !reached.has(key)) continue;
      unlocked.add(dungeon.id);
      for (const kind of dungeon.unlocks) unlockedKinds.add(kind);
      progressed = true;
    }
    if (progressed) {
      reached = floodFillReachable(width, height, town, (x, y) => isPassable(x, y, unlockedKinds));
    }
  }

  const stuck = dungeons
    .filter((dungeon) => !unlocked.has(dungeon.id))
    .map((dungeon) => ({ id: dungeon.id, label: dungeon.label, placed: !!dungeon.pos }));

  if (stuck.length === 0) {
    return { ok: true, stuck: [], reached, frontier: new Set() };
  }
  return {
    ok: false,
    stuck,
    reached,
    frontier: computeFrontier(width, height, reached, (x, y) => isPassable(x, y, unlockedKinds)),
  };
}
