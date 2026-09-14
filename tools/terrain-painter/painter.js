import { TOOL_UNLOCK_KINDS, floodFillReachable, checkProgression } from './reachability.js';
import { MONSTERS } from '../../js/data/monsters.js';
import { TILES } from '../../js/tiles.js';

const SCREEN_W = 30;
const SCREEN_H = 22;
const CELL = 8;

const GRID_LAYOUT = {
  farNorthwest: { col: 0, row: 0 }, northNorthwest: { col: 1, row: 0 }, farNorth: { col: 2, row: 0 },
  northNortheast: { col: 3, row: 0 }, farNortheast: { col: 4, row: 0 },
  westNorthwest: { col: 0, row: 1 }, northwest: { col: 1, row: 1 }, north: { col: 2, row: 1 },
  northeast: { col: 3, row: 1 }, eastNortheast: { col: 4, row: 1 },
  farWest: { col: 0, row: 2 }, west: { col: 1, row: 2 }, center: { col: 2, row: 2 },
  east: { col: 3, row: 2 }, farEast: { col: 4, row: 2 },
  westSouthwest: { col: 0, row: 3 }, southwest: { col: 1, row: 3 }, south: { col: 2, row: 3 },
  southeast: { col: 3, row: 3 }, eastSoutheast: { col: 4, row: 3 },
  farSouthwest: { col: 0, row: 4 }, southSouthwest: { col: 1, row: 4 }, farSouth: { col: 2, row: 4 },
  southSoutheast: { col: 3, row: 4 }, farSoutheast: { col: 4, row: 4 },
};

const WORLD_W = SCREEN_W * 5;
const WORLD_H = SCREEN_H * 5;

const TILE_COLORS = {
  grass: '#4a7c3f',
  tree: '#1f4d1f',
  water: '#2b6cb0',
  mountainWall: '#5c5044',
  mountain: '#8a8a8a',
  mountainCache: '#d4af37',
  thicket: '#2f5d34',
  thicketCache: '#9acd32',
  townEntrance: '#d9534f',
  exit: '#8a6d3b',
  boss: '#8b0000',
  guardian: '#8c7853',
  caveFloor: '#5a5248',
  caveWall: '#2e2a26',
  cavePool: '#1f3f5c',
  miniDungeonEntrance: '#2ec4b6',
  miniDungeonTreasure: '#d4af37',
};

// Chars mirror each real map file's own existing convention exactly (dungeonMap.js
// already uses E/B/T for exit/boss/thicket; the mini-dungeon variants already use
// E/T for entrance/treasure) - safe to share one char across two kinds here since
// wilderness, dungeon, and mini-dungeon palettes never mix within a single export.
const CHAR_FOR_KIND = {
  grass: '.', tree: '#', water: '~', mountainWall: 'W', mountain: 'M', mountainCache: 'K',
  thicket: 'T', thicketCache: 'X', townEntrance: '@',
  exit: 'E', boss: 'B', guardian: 'G',
  caveFloor: '.', caveWall: '#', cavePool: '~',
  miniDungeonEntrance: 'E', miniDungeonTreasure: 'T',
};

const WILDERNESS_PALETTE = ['grass', 'tree', 'water', 'mountainWall', 'mountain', 'mountainCache', 'thicket', 'thicketCache'];
const DUNGEON_PALETTE = ['grass', 'tree', 'thicket', 'exit', 'boss'];
const MINI_DUNGEON_PALETTE = ['caveFloor', 'caveWall', 'cavePool', 'miniDungeonEntrance', 'miniDungeonTreasure'];
// "New Dungeon" blank-canvas mode's palette (Task 12) - a superboss's own
// dungeon interior, styled as a proper cave (caveFloor/caveWall, matching
// js/tiles.js) rather than the grass/tree look the older dragon/tool
// dungeons happen to reuse, but still exits/ends the same way every real
// tool-dungeon file does: an exit door and a guardian encounter tile
// (action: 'guardianBattle', which generically reads
// MAPS[state.map].guardianMonsterId - not 'boss'/'bossBattle', which is
// wired specifically to the one real dragon fight's own handler in
// js/main.js and would be unsafe to reuse for an arbitrary new dungeon).
const NEW_DUNGEON_PALETTE = ['caveFloor', 'caveWall', 'exit', 'guardian'];
// Mirrors buildLegendRowsText's own IDENTIFIER_KEY test - a new dungeon's
// map id becomes both a MAPS registry key and a file's exported const
// name (Task 13), so it has to be a legal bare JS identifier.
const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Icon shown on the palette button; hovering shows PALETTE_LABELS' full description.
// A star suffix marks the "has reward" variant of a tool-gated tile, since the base
// tile emoji is otherwise identical to its non-reward counterpart (matches js/tiles.js).
const PALETTE_ICONS = {
  grass: '🟩', tree: '🌲', water: '🟦', mountainWall: '🗻',
  mountain: '⛰️', mountainCache: '⛰️⭐', thicket: '🌳', thicketCache: '🌳⭐',
  exit: '🚪', boss: '🐉', guardian: '⚔️',
  caveFloor: '⬛', caveWall: '🪨', cavePool: '💧',
  miniDungeonEntrance: '🪜', miniDungeonTreasure: '💰',
};

const PALETTE_LABELS = {
  grass: 'Grass', tree: 'Tree (permanent wall)', water: 'Water',
  mountainWall: 'Mountain (permanent wall)',
  mountain: 'Mountain (needs pick)', mountainCache: 'Mountain (needs pick, has reward)',
  thicket: 'Thicket (needs axe)', thicketCache: 'Thicket (needs axe, has reward)',
  exit: 'Exit', boss: 'Boss', guardian: 'Guardian',
  caveFloor: 'Cave Floor', caveWall: 'Cave Wall', cavePool: 'Cave Pool',
  miniDungeonEntrance: 'Entrance', miniDungeonTreasure: 'Treasure',
};

const SINGLE_MAPS = {
  dungeon: {
    label: 'Dungeon (dragon)', modulePath: '../../js/maps/dungeonMap.js',
    exportName: 'dungeonMap', palette: DUNGEON_PALETTE, defaultKind: 'grass',
  },
  miniDungeonA: {
    label: 'Mini-Dungeon A', modulePath: '../../js/maps/miniDungeons/variantA.js',
    exportName: 'miniDungeonVariantA', palette: MINI_DUNGEON_PALETTE, defaultKind: 'caveFloor',
  },
  miniDungeonB: {
    label: 'Mini-Dungeon B', modulePath: '../../js/maps/miniDungeons/variantB.js',
    exportName: 'miniDungeonVariantB', palette: MINI_DUNGEON_PALETTE, defaultKind: 'caveFloor',
  },
  miniDungeonC: {
    label: 'Mini-Dungeon C', modulePath: '../../js/maps/miniDungeons/variantC.js',
    exportName: 'miniDungeonVariantC', palette: MINI_DUNGEON_PALETTE, defaultKind: 'caveFloor',
  },
  miniDungeonD: {
    label: 'Mini-Dungeon D', modulePath: '../../js/maps/miniDungeons/variantD.js',
    exportName: 'miniDungeonVariantD', palette: MINI_DUNGEON_PALETTE, defaultKind: 'caveFloor',
  },
  miniDungeonE: {
    label: 'Mini-Dungeon E', modulePath: '../../js/maps/miniDungeons/variantE.js',
    exportName: 'miniDungeonVariantE', palette: MINI_DUNGEON_PALETTE, defaultKind: 'caveFloor',
  },
  axeDungeon: {
    label: 'Axe Dungeon', modulePath: '../../js/maps/toolDungeons/axeDungeon.js',
    exportName: 'axeDungeonMap', palette: DUNGEON_PALETTE, defaultKind: 'grass',
  },
  pickDungeon: {
    label: 'Pick Dungeon', modulePath: '../../js/maps/toolDungeons/pickDungeon.js',
    exportName: 'pickDungeonMap', palette: DUNGEON_PALETTE, defaultKind: 'grass',
  },
  canoeDungeon: {
    label: 'Canoe Dungeon', modulePath: '../../js/maps/toolDungeons/canoeDungeon.js',
    exportName: 'canoeDungeonMap', palette: DUNGEON_PALETTE, defaultKind: 'grass',
  },
  portalDungeon: {
    label: 'Portal Dungeon', modulePath: '../../js/maps/toolDungeons/portalDungeon.js',
    exportName: 'portalDungeonMap', palette: DUNGEON_PALETTE, defaultKind: 'grass',
  },
};

const AUTOSAVE_KEY = 'terrain-painter-autosave-v1';

// tree and mountainWall never clear (permanent walls) - stay impassable in
// every reachability check below, tools or not.
const TOOLLESS_PASSABLE_KINDS = new Set(['grass', 'townEntrance']);
const TOOLED_PASSABLE_KINDS = new Set(['grass', 'townEntrance', 'thicket', 'thicketCache', 'mountain', 'mountainCache', 'water']);

let grid = []; // wilderness world grid, always kept in memory even while editing a single map
let singleGrid = []; // active single map's grid (dungeon / mini-dungeon), only valid when currentMapKey !== 'wilderness'
let singleMapW = 0;
let singleMapH = 0;
let currentMapKey = 'wilderness'; // 'wilderness' | key into SINGLE_MAPS
let activeBrush = 'grass';
let painting = false;
let brushSize = 1; // radius in cells - 1 means "just the cell under the cursor"
let brushShape = 'square';
let hoverCell = null; // { x, y } in active-grid coordinates, or null when the cursor is off-canvas
let dungeonMarker = null; // { screenId, x, y } - the one fixed dungeon entrance spot (wilderness only)
let placingDungeon = false;
let toolDungeonMarkers = {}; // toolId -> { screenId, x, y } (wilderness only)
let placingToolDungeon = null; // toolId currently being placed, or null
let superBossMarkers = {}; // superBossId -> { screenId, x, y, hasDungeon } (wilderness only)
let placingSuperBoss = null; // superBossId currently being placed, or null
// { phase: 'animating', settledFree, settledToolGated: Set<string>, exploring: Set<string> }
// while the staged multi-wave reveal below is still running, or
// { phase: 'done', toollessReached, tooledReached, frontier: Set<string> }
// once every wave has settled and the real verdict is shown - null when
// nothing's been checked yet (wilderness only).
let checkOverlay = null;
let wildernessCheckAnimId = 0; // bumped to invalidate any in-flight reveal animation (stale click, map switch, or edit)
// { phase: 'animating', revealed: Set<string> } while the reveal animation
// below is still running, or { phase: 'done', unreached: Set<string> } once
// it finishes and the real verdict is shown - null when nothing's been
// checked yet (single-map view only).
let dungeonCheckOverlay = null;
let dungeonCheckAnimId = 0; // bumped to invalidate any in-flight reveal animation (stale click, map switch, or edit)
let unsavedChangeCount = 0; // edits made since the last successful export/save (or since load, if restored from autosave)
let undoStacks = {}; // mapKey -> array of { grid, dungeonMarker, toolDungeonMarkers, superBossMarkers } snapshots, oldest first
const UNDO_LIMIT = 30;

const TOOL_DUNGEON_IDS = ['axe', 'pick', 'canoe', 'portal'];
const TOOL_DUNGEON_MARKER_COLORS = { axe: '#5cb85c', pick: '#5bc0de', canoe: '#e0a83a', portal: '#b06fd6' };
// Superboss ids are data-driven (SUPER_BOSSES' keys, loaded at init) rather
// than a fixed small set like the tools above, so markers are colored by
// hasDungeon instead of by id.
const SUPER_BOSS_MARKER_COLOR_DUNGEON = '#ff5757';
const SUPER_BOSS_MARKER_COLOR_OPEN = '#ffd23f';

function cloneGrid(g) {
  return g.map((row) => row.slice());
}

function cloneToolDungeonMarkers(markers) {
  const out = {};
  for (const [toolId, pos] of Object.entries(markers)) out[toolId] = { ...pos };
  return out;
}

function pushUndoSnapshot() {
  const active = getActive();
  const stack = undoStacks[currentMapKey] || (undoStacks[currentMapKey] = []);
  stack.push({
    grid: cloneGrid(active.grid),
    dungeonMarker: dungeonMarker ? { ...dungeonMarker } : null,
    toolDungeonMarkers: cloneToolDungeonMarkers(toolDungeonMarkers),
    superBossMarkers: cloneToolDungeonMarkers(superBossMarkers),
  });
  if (stack.length > UNDO_LIMIT) stack.shift();
}

function undo() {
  const stack = undoStacks[currentMapKey];
  if (!stack || stack.length === 0) return false;
  const snapshot = stack.pop();
  if (currentMapKey === 'wilderness') {
    grid = snapshot.grid;
    dungeonMarker = snapshot.dungeonMarker;
    toolDungeonMarkers = snapshot.toolDungeonMarkers || {};
    superBossMarkers = snapshot.superBossMarkers || {};
  } else {
    singleGrid = snapshot.grid;
  }
  checkOverlay = null; wildernessCheckAnimId++; // stale as soon as terrain is restored
  return true;
}

function worldToLocal(wx, wy) {
  for (const [id, pos] of Object.entries(GRID_LAYOUT)) {
    const originX = pos.col * SCREEN_W;
    const originY = pos.row * SCREEN_H;
    if (wx >= originX && wx < originX + SCREEN_W && wy >= originY && wy < originY + SCREEN_H) {
      return { screenId: id, x: wx - originX, y: wy - originY };
    }
  }
  return null;
}

function localToWorld(screenId, x, y) {
  const pos = GRID_LAYOUT[screenId];
  if (!pos) return null;
  return { wx: pos.col * SCREEN_W + x, wy: pos.row * SCREEN_H + y };
}

function decodeGrid(map) {
  const h = map.rows.length;
  const w = map.rows[0].length;
  const g = Array.from({ length: h }, () => new Array(w).fill('grass'));
  for (let y = 0; y < h; y++) {
    const row = map.rows[y];
    for (let x = 0; x < w; x++) {
      g[y][x] = map.legend[row[x]];
    }
  }
  return { grid: g, w, h };
}

async function loadAllScreens() {
  const newGrid = Array.from({ length: WORLD_H }, () => new Array(WORLD_W).fill('grass'));
  for (const [id, pos] of Object.entries(GRID_LAYOUT)) {
    const mod = await import(`../../js/maps/wilderness/${id}.js`);
    const map = mod[`${id}Map`];
    const originX = pos.col * SCREEN_W;
    const originY = pos.row * SCREEN_H;
    for (let y = 0; y < SCREEN_H; y++) {
      const row = map.rows[y];
      for (let x = 0; x < SCREEN_W; x++) {
        const kind = map.legend[row[x]];
        newGrid[originY + y][originX + x] = kind;
      }
    }
  }
  return newGrid;
}

async function loadSingleMap(key) {
  const def = SINGLE_MAPS[key];
  const mod = await import(def.modulePath);
  return decodeGrid(mod[def.exportName]);
}

function getActive() {
  if (currentMapKey === 'wilderness') return { grid, w: WORLD_W, h: WORLD_H, isWilderness: true };
  return { grid: singleGrid, w: singleMapW, h: singleMapH, isWilderness: false };
}

// Mirrors js/screens/mapScreen.js's isSealedWorldEdge: the true outer
// boundary of the 5x5 world (a screen side with no neighbor at all) always
// renders as mountainWall in the real game regardless of what's painted
// there, since leaving the map is already blocked structurally. Shown the
// same way here, and locked from painting, so there's never a mismatch
// between what you paint and what the game actually shows.
function isSealedWorldEdge(wx, wy) {
  const local = worldToLocal(wx, wy);
  if (!local) return false;
  const pos = GRID_LAYOUT[local.screenId];
  if (local.y === 0 && pos.row === 0) return true;
  if (local.y === SCREEN_H - 1 && pos.row === 4) return true;
  if (local.x === 0 && pos.col === 0) return true;
  if (local.x === SCREEN_W - 1 && pos.col === 4) return true;
  return false;
}

function renderWilderness(ctx) {
  ctx.clearRect(0, 0, WORLD_W * CELL, WORLD_H * CELL);
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      ctx.fillStyle = isSealedWorldEdge(x, y) ? TILE_COLORS.mountainWall : (TILE_COLORS[grid[y][x]] || '#000');
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  if (checkOverlay && checkOverlay.phase === 'animating') {
    // Tool-gated tiles settled by an earlier wave stay yellow while a later
    // wave is still exploring; the wave currently in flight gets the same
    // teal "exploring" tint the dungeon-interior check uses. Tiles settled
    // by the very first (toolless) wave get no tint at all, same as the
    // final done-state below.
    for (const key of checkOverlay.settledToolGated) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(224,192,57,0.35)';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    for (const key of checkOverlay.exploring) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(46,196,182,0.45)';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  } else if (checkOverlay && checkOverlay.phase === 'done') {
    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const key = `${x},${y}`;
        if (checkOverlay.frontier.has(key)) {
          // The blocking boundary at the point the unlock progression got
          // stuck (some dungeon(s) never became reachable through any
          // order) - takes priority over the general tint below since this
          // is specifically "the player gets stuck right here," not just
          // "unreachable somewhere."
          ctx.fillStyle = 'rgba(230,30,200,0.65)';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          continue;
        }
        if (checkOverlay.toollessReached.has(key)) continue; // freely reachable, no tint
        ctx.fillStyle = checkOverlay.tooledReached.has(key)
          ? 'rgba(224,192,57,0.35)' // reachable only with a tool
          : 'rgba(224,60,60,0.4)'; // not reachable even with every tool
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= 5; c++) {
    ctx.beginPath();
    ctx.moveTo(c * SCREEN_W * CELL, 0);
    ctx.lineTo(c * SCREEN_W * CELL, WORLD_H * CELL);
    ctx.stroke();
  }
  for (let r = 0; r <= 5; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * SCREEN_H * CELL);
    ctx.lineTo(WORLD_W * CELL, r * SCREEN_H * CELL);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '10px monospace';
  for (const [id, pos] of Object.entries(GRID_LAYOUT)) {
    ctx.fillText(id, pos.col * SCREEN_W * CELL + 2, pos.row * SCREEN_H * CELL + 10);
  }

  if (dungeonMarker) {
    const world = localToWorld(dungeonMarker.screenId, dungeonMarker.x, dungeonMarker.y);
    if (world) {
      const cx = world.wx * CELL + CELL / 2;
      const cy = world.wy * CELL + CELL / 2;
      ctx.fillStyle = '#e07b39';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  for (const [toolId, pos] of Object.entries(toolDungeonMarkers)) {
    const world = localToWorld(pos.screenId, pos.x, pos.y);
    if (!world) continue;
    const cx = world.wx * CELL + CELL / 2;
    const cy = world.wy * CELL + CELL / 2;
    ctx.fillStyle = TOOL_DUNGEON_MARKER_COLORS[toolId] || '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(toolId[0].toUpperCase(), cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Labeled SB1/SB2/... by position in superBossMarkers' own key order (which
  // mirrors SUPER_BOSSES' declaration order) rather than the id's own text -
  // every current id starts "superBoss", so the old `slice(0, 2)` labeled
  // every single marker "SU", indistinguishable on the map (raised by
  // Timothy once a second superboss existed to collide with the first).
  const superBossIdsInOrder = Object.keys(superBossMarkers);
  for (const [markerIndex, superBossId] of superBossIdsInOrder.entries()) {
    const pos = superBossMarkers[superBossId];
    const world = localToWorld(pos.screenId, pos.x, pos.y);
    if (!world) continue;
    const cx = world.wx * CELL + CELL / 2;
    const cy = world.wy * CELL + CELL / 2;
    ctx.fillStyle = pos.hasDungeon ? SUPER_BOSS_MARKER_COLOR_DUNGEON : SUPER_BOSS_MARKER_COLOR_OPEN;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`SB${markerIndex + 1}`, cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

function renderSingleMap(ctx) {
  ctx.clearRect(0, 0, singleMapW * CELL, singleMapH * CELL);
  for (let y = 0; y < singleMapH; y++) {
    for (let x = 0; x < singleMapW; x++) {
      ctx.fillStyle = TILE_COLORS[singleGrid[y][x]] || '#000';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  if (dungeonCheckOverlay && dungeonCheckOverlay.phase === 'animating') {
    for (const key of dungeonCheckOverlay.revealed) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(46,196,182,0.45)'; // exploring - same teal as miniDungeonEntrance, reads as "in progress"
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  } else if (dungeonCheckOverlay && dungeonCheckOverlay.phase === 'done') {
    for (const key of dungeonCheckOverlay.unreached) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(230,30,200,0.65)';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function render(ctx) {
  if (currentMapKey === 'wilderness') renderWilderness(ctx);
  else renderSingleMap(ctx);
  drawBrushPreview(ctx);
}

function paintAt(x, y) {
  const active = getActive();
  if (x < 0 || x >= active.w || y < 0 || y >= active.h) return;
  if (active.isWilderness && active.grid[y][x] === 'townEntrance') return;
  if (active.isWilderness && isSealedWorldEdge(x, y)) return;
  active.grid[y][x] = activeBrush;
  if (active.isWilderness) { checkOverlay = null; wildernessCheckAnimId++; } // stale as soon as the terrain changes
  else { dungeonCheckOverlay = null; dungeonCheckAnimId++; }
}

function brushCells(cx, cy) {
  const r = brushSize - 1;
  const cells = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (brushShape === 'circle' && Math.sqrt(dx * dx + dy * dy) > r + 0.5) continue;
      cells.push([cx + dx, cy + dy]);
    }
  }
  return cells;
}

function paintBrush(cx, cy) {
  for (const [x, y] of brushCells(cx, cy)) paintAt(x, y);
}

// Shows exactly which cells the next click would paint, so an oversized
// brushSize (easy to lose track of, especially with the [/] shortcuts) is
// visible before it lands instead of after. Hidden mid-stroke - the live
// paint fill is already the feedback at that point.
function drawBrushPreview(ctx) {
  if (!hoverCell || painting) return;
  const active = getActive();
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1;
  for (const [x, y] of brushCells(hoverCell.x, hoverCell.y)) {
    if (x < 0 || x >= active.w || y < 0 || y >= active.h) continue;
    ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL - 1, CELL - 1);
  }
  ctx.restore();
}

// Tracked separately from saveAutosave() (which just persists to
// localStorage on every real edit AND on a "reset from files" reload that
// deliberately discards changes) - the two don't always agree on whether
// the current state is "dirty" relative to disk, so each call site below
// says explicitly which one it means.
function updateUnsavedIndicator() {
  const status = document.getElementById('unsavedChangesStatus');
  if (!status) return;
  status.textContent = unsavedChangeCount > 0
    ? `${unsavedChangeCount} unsaved change${unsavedChangeCount === 1 ? '' : 's'}`
    : '';
  // Only #exportAllBtn ever calls clearDirty() on success (along with
  // saveNewDungeonBtn) - #exportBtn ("Copy LEGEND/ROWS") just copies to the
  // clipboard and can't clear this itself (the user still has to paste it
  // somewhere), so it never glows: a glow that can't turn off is worse than
  // no glow at all.
  document.getElementById('exportAllBtn')?.classList.toggle('dirty', unsavedChangeCount > 0);
}

function markDirty() {
  unsavedChangeCount++;
  updateUnsavedIndicator();
}

function clearDirty() {
  unsavedChangeCount = 0;
  updateUnsavedIndicator();
}

function saveAutosave() {
  try {
    const singleMaps = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || '{}').singleMaps || {};
    if (currentMapKey !== 'wilderness') singleMaps[currentMapKey] = singleGrid;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ grid, dungeonMarker, toolDungeonMarkers, superBossMarkers, singleMaps }));
  } catch (err) {
    // localStorage may be unavailable (private browsing, quota) - painting still
    // works, it just won't survive a refresh. Nothing to do here.
  }
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { grid: parsed, dungeonMarker: null, singleMaps: {} } : parsed;
  } catch (err) {
    return null;
  }
}

function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (err) {
    // nothing to do
  }
}

function buildLegendRowsText(gridSlice, w, h) {
  const usedKinds = new Set();
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const kind = gridSlice[y][x];
      usedKinds.add(kind);
      row += CHAR_FOR_KIND[kind];
    }
    rows.push(row);
  }
  const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const legendEntries = [...usedKinds]
    .map((kind) => {
      const char = CHAR_FOR_KIND[kind];
      const key = IDENTIFIER_KEY.test(char) ? char : `'${char}'`;
      return `${key}: '${kind}'`;
    })
    .join(', ');
  const rowsEntries = rows.map((r) => `  '${r}',`).join('\n');
  return `const LEGEND = { ${legendEntries} };\n\nconst ROWS = [\n${rowsEntries}\n];`;
}

function exportScreen(id) {
  const pos = GRID_LAYOUT[id];
  const originX = pos.col * SCREEN_W;
  const originY = pos.row * SCREEN_H;
  const slice = [];
  for (let y = 0; y < SCREEN_H; y++) {
    slice.push(grid[originY + y].slice(originX, originX + SCREEN_W));
  }
  return buildLegendRowsText(slice, SCREEN_W, SCREEN_H);
}

function exportSingleMap() {
  return buildLegendRowsText(singleGrid, singleMapW, singleMapH);
}

// Whether the currently-loaded single map can be saved straight to disk via
// /api/patch-single-map: it has to be a real existing file (excludes both
// wilderness, which uses its own bulk-export path, and an in-progress "New
// Dungeon" that has no file yet - that one's first save has to go through
// /api/create-dungeon instead, which also handles main.js registration).
function canSaveSingleMapToServer() {
  if (currentMapKey === 'wilderness' || !serverAvailable) return false;
  const def = SINGLE_MAPS[currentMapKey];
  return Boolean(def && !def.isNewDungeon);
}

// #exportBtn's one action, named for what it actually does in each mode:
// writes straight to disk when it can (any pre-existing single map, e.g. a
// tool/dragon/mini/superboss dungeon, with the authoring server running),
// otherwise falls back to the old copy-to-clipboard-and-paste-by-hand flow
// (wilderness screens always use this - they're covered by "Export All
// Changed to Files" instead - and so does any setup without the server).
async function performExportOrSave() {
  const status = document.getElementById('exportStatus');
  if (canSaveSingleMapToServer()) {
    status.textContent = 'Saving…';
    try {
      const { changed } = await postJson('/api/patch-single-map', { mapId: currentMapKey, legendRowsText: exportSingleMap() });
      status.textContent = changed ? 'Saved to disk.' : 'Already up to date on disk.';
      clearDirty();
    } catch (err) {
      status.textContent = `Failed: ${err.message}`;
    }
    return;
  }
  const text = currentMapKey === 'wilderness'
    ? exportScreen(document.getElementById('exportSelect').value)
    : exportSingleMap();
  document.getElementById('exportOutput').value = text;
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = 'Copied to clipboard.';
  } catch (err) {
    status.textContent = 'Clipboard blocked — copy from the text box below.';
  }
}

function updateExportBtnLabel() {
  document.getElementById('exportBtn').textContent = canSaveSingleMapToServer() ? 'Save to Server' : 'Copy LEGEND/ROWS';
}

// --- Bulk export straight to disk (File System Access API) -----------------
// Avoids the 25x manual "copy LEGEND/ROWS, paste over the file" cycle for the
// wilderness screens. Reads each real file fresh, patches only its
// LEGEND/ROWS block (or, for state.js/toolDungeons.js, only the specific
// position fields), and writes back - never regenerates a whole file, so
// unrelated content (imports, comments, the export statement) is untouched.
// The non-greedy "first closing delimiter" regexes and sanity checks mirror
// the ones already proven safe earlier in this project for the same job -
// an earlier newline-anchored version of this same idea corrupted files by
// matching past a single-line LEGEND declaration straight through to the
// end of the file.
let repoDirHandle = null;

async function pickRepoDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  // Sanity check: this should be the repo root, not some other folder -
  // confirm it directly contains a 'js' directory before trusting it.
  await handle.getDirectoryHandle('js');
  repoDirHandle = handle;
  return handle.name;
}

async function getFileHandleForPath(relativePath) {
  const parts = relativePath.split('/');
  let dir = repoDirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  return dir.getFileHandle(parts[parts.length - 1]);
}

async function readFileText(relativePath) {
  const fh = await getFileHandleForPath(relativePath);
  return (await fh.getFile()).text();
}

async function writeFileText(relativePath, text) {
  const fh = await getFileHandleForPath(relativePath);
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}

function patchLegendRows(originalText, newLegendRowsText, fileLabel) {
  const legendRe = /const LEGEND = \{[\s\S]*?\};/;
  const rowsRe = /const ROWS = \[[\s\S]*?\];/;
  const legendMatch = originalText.match(legendRe);
  const rowsMatch = originalText.match(rowsRe);
  if (!legendMatch || !rowsMatch) throw new Error(`${fileLabel}: could not find LEGEND/ROWS block`);
  if (rowsMatch.index <= legendMatch.index) throw new Error(`${fileLabel}: ROWS appears before LEGEND - unexpected file shape, aborting`);
  if (!/'.+',/.test(rowsMatch[0])) throw new Error(`${fileLabel}: ROWS block doesn't look like row strings - aborting`);
  const newLegendText = newLegendRowsText.match(legendRe)[0];
  const newRowsText = newLegendRowsText.match(rowsRe)[0];
  return originalText.replace(legendRe, newLegendText).replace(rowsRe, newRowsText);
}

function patchDungeonEntrancePosition(originalText, pos) {
  const re = /export const DEFAULT_DUNGEON_ENTRANCE_POSITION = \{[^}]*\};/;
  if (!re.test(originalText)) throw new Error('state.js: could not find DEFAULT_DUNGEON_ENTRANCE_POSITION');
  return originalText.replace(re, `export const DEFAULT_DUNGEON_ENTRANCE_POSITION = { screenId: '${pos.screenId}', x: ${pos.x}, y: ${pos.y} };`);
}

function patchToolDungeonEntrance(originalText, toolId, pos) {
  const blockRe = new RegExp(`${toolId}: \\{[^}]*\\}`);
  const match = originalText.match(blockRe);
  if (!match) throw new Error(`toolDungeons.js: could not find '${toolId}' entry`);
  const mapIdMatch = match[0].match(/mapId: '([^']*)'/);
  const tileKindMatch = match[0].match(/tileKind: '([^']*)'/);
  if (!mapIdMatch || !tileKindMatch) throw new Error(`toolDungeons.js: '${toolId}' entry missing mapId/tileKind`);
  const newBlock = `${toolId}: {\n    screenId: '${pos.screenId}', x: ${pos.x}, y: ${pos.y}, mapId: '${mapIdMatch[1]}', tileKind: '${tileKindMatch[1]}',\n  }`;
  return originalText.replace(blockRe, newBlock);
}

// Returns a summary string. Writes every changed wilderness screen, the
// dungeon entrance position, and all three tool dungeon entrance positions -
// everything that otherwise needs its own manual copy/paste. Stops at the
// first error rather than leaving a partial, hard-to-audit set of writes.
async function exportAllToFiles() {
  if (!repoDirHandle) throw new Error('Choose your repo folder first.');
  let written = 0;
  let unchanged = 0;
  const changedFiles = [];

  for (const id of Object.keys(GRID_LAYOUT)) {
    const relativePath = `js/maps/wilderness/${id}.js`;
    const originalText = await readFileText(relativePath);
    const patched = patchLegendRows(originalText, exportScreen(id), relativePath);
    if (patched === originalText) { unchanged++; continue; }
    await writeFileText(relativePath, patched);
    written++;
    changedFiles.push(id);
  }

  if (dungeonMarker) {
    const relativePath = 'js/state.js';
    const originalText = await readFileText(relativePath);
    const patched = patchDungeonEntrancePosition(originalText, dungeonMarker);
    if (patched !== originalText) {
      await writeFileText(relativePath, patched);
      written++;
      changedFiles.push('dungeon entrance (state.js)');
    } else {
      unchanged++;
    }
  }

  if (Object.keys(toolDungeonMarkers).length > 0) {
    const relativePath = 'js/data/toolDungeons.js';
    let originalText = await readFileText(relativePath);
    let text = originalText;
    let anyChanged = false;
    for (const [toolId, pos] of Object.entries(toolDungeonMarkers)) {
      text = patchToolDungeonEntrance(text, toolId, pos);
    }
    if (text !== originalText) {
      await writeFileText(relativePath, text);
      written++;
      anyChanged = true;
      changedFiles.push('tool dungeon entrances (toolDungeons.js)');
    }
    if (!anyChanged) unchanged++;
  }

  return `Wrote ${written} changed file(s)${changedFiles.length ? ': ' + changedFiles.join(', ') : ''}. ${unchanged} already up to date.`;
}

// --- Bulk export via the Node authoring server (Task 13) --------------------
// Same job as exportAllToFiles() above, minus the dungeon-entrance/
// tool-dungeon-entrance patching (no server endpoint for those - both are
// already placed and stable on this branch; use "Choose Repo Folder" +
// the File System Access flow above for the rare case either needs to
// move again). Works in any browser, not just Chrome/Edge, since it never
// touches showDirectoryPicker.
let serverAvailable = null; // null = not checked yet, else boolean

async function checkServerAvailable() {
  try {
    const res = await fetch('/api/patch-wilderness', { method: 'OPTIONS' });
    return res.ok;
  } catch (err) {
    return false; // no server reachable at all (e.g. plain python3 -m http.server, or file://)
  }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json()).error || message; } catch (err) { /* non-JSON error body - keep the status */ }
    throw new Error(`${path}: ${message}`);
  }
  return res.json();
}

async function exportAllToServer() {
  let written = 0;
  let unchanged = 0;
  const changedFiles = [];

  for (const id of Object.keys(GRID_LAYOUT)) {
    const { changed } = await postJson('/api/patch-wilderness', { screenId: id, legendRowsText: exportScreen(id) });
    if (changed) { written++; changedFiles.push(id); } else unchanged++;
  }

  // Only markers that have actually been placed (a real screenId, not the
  // registry's inert null-placeholder) have anything meaningful to write -
  // see js/data/superBosses.js's own doc comment on that placeholder shape.
  for (const [superBossId, pos] of Object.entries(superBossMarkers)) {
    if (pos.screenId === null) continue;
    const entry = { screenId: pos.screenId, x: pos.x, y: pos.y, hasDungeon: pos.hasDungeon };
    const { changed } = await postJson('/api/patch-superboss', { superBossId, entry });
    if (changed) { written++; changedFiles.push(`superboss ${superBossId}`); } else unchanged++;
  }

  return `Wrote ${written} changed file(s)${changedFiles.length ? ': ' + changedFiles.join(', ') : ''}. ${unchanged} already up to date. (Dungeon/tool-dungeon entrance positions aren't wired to the server - use "Choose Repo Folder" for those.)`;
}

function findTownEntrance() {
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (grid[y][x] === 'townEntrance') return { x, y };
    }
  }
  return null;
}

function cellPassable(passableKinds, x, y) {
  // The real game's mapScreen.js always renders the dungeon-entrance tile (and
  // the tool-dungeon entrances) as walkable at their exact marker position,
  // regardless of the terrain painted underneath - matching that here so the
  // check reflects actual game behavior.
  if (dungeonMarker) {
    const world = localToWorld(dungeonMarker.screenId, dungeonMarker.x, dungeonMarker.y);
    if (world && world.wx === x && world.wy === y) return true;
  }
  for (const pos of Object.values(toolDungeonMarkers)) {
    const world = localToWorld(pos.screenId, pos.x, pos.y);
    if (world && world.wx === x && world.wy === y) return true;
  }
  if (isSealedWorldEdge(x, y)) return false; // always mountainWall in the real game, regardless of raw grid content
  return passableKinds.has(grid[y][x]);
}

function worldKeyFor(marker) {
  if (!marker) return null;
  const world = localToWorld(marker.screenId, marker.x, marker.y);
  return world ? { x: world.wx, y: world.wy } : null;
}

// The verdict (ok/fail, status text) is decided synchronously below, exactly
// as before this task's animation was added - only the on-screen reveal is
// animated, staged wave by wave against `result.passes` (see reachability.js):
// wave 0 is the toolless flood, each wave after it is the re-flood triggered
// by a dungeon unlocking. Only each wave's *new* tiles (this pass's reached
// set minus the previous one's) animate in, in BFS order, at a rate the
// checkMapSpeed slider controls - same "Set iteration order IS discovery
// order" trick checkDungeonMap uses. A wave that unlocks nothing new (e.g. the
// portal/dragon dungeons, which don't gate any terrain) has an empty delta and
// is skipped instantly, no pause. Once every wave has settled, the overlay
// swaps to the exact same final toollessReached/tooledReached/frontier tinting
// this function already produced before animation existed.
function checkMap(ctx) {
  const status = document.getElementById('checkStatus');
  const town = findTownEntrance();
  wildernessCheckAnimId++;
  const myAnimId = wildernessCheckAnimId;
  if (!town) {
    checkOverlay = null;
    status.textContent = 'No townEntrance tile found on the map - cannot check.';
    status.className = 'fail';
    render(ctx);
    return;
  }

  const isPassable = (x, y, unlockedKinds) => cellPassable(unlockedKinds, x, y);
  const toollessReached = floodFillReachable(WORLD_W, WORLD_H, town, (x, y) => isPassable(x, y, TOOLLESS_PASSABLE_KINDS));
  const tooledReached = floodFillReachable(WORLD_W, WORLD_H, town, (x, y) => isPassable(x, y, TOOLED_PASSABLE_KINDS));

  // Order-independent progression check: unlock whichever dungeons become
  // reachable, in whatever order that actually happens, and repeat until a
  // full pass unlocks nothing new. Doesn't assume a fixed axe -> pick ->
  // canoe order - a different real order (or a future different tool set)
  // is just as sound as long as every dungeon eventually unlocks. See
  // reachability.js (also unit tested there).
  const dungeons = [
    { id: 'axe', label: 'axe dungeon', pos: worldKeyFor(toolDungeonMarkers.axe), unlocks: TOOL_UNLOCK_KINDS.axe },
    { id: 'pick', label: 'pick dungeon', pos: worldKeyFor(toolDungeonMarkers.pick), unlocks: TOOL_UNLOCK_KINDS.pick },
    { id: 'canoe', label: 'canoe dungeon (boat)', pos: worldKeyFor(toolDungeonMarkers.canoe), unlocks: TOOL_UNLOCK_KINDS.canoe },
    { id: 'portal', label: 'portal dungeon', pos: worldKeyFor(toolDungeonMarkers.portal), unlocks: [] },
    { id: 'dragon', label: 'dragon dungeon', pos: worldKeyFor(dungeonMarker), unlocks: [] },
  ];

  const result = checkProgression({
    width: WORLD_W, height: WORLD_H, town, isPassable, toollessKinds: TOOLLESS_PASSABLE_KINDS, dungeons,
  });

  const finalOverlay = { phase: 'done', toollessReached, tooledReached, frontier: result.frontier };
  let finalStatusText;
  let finalStatusClass;

  if (!result.ok) {
    const unplaced = result.stuck.filter((d) => !d.placed);
    const unreachable = result.stuck.filter((d) => d.placed);
    const parts = [];
    if (unplaced.length > 0) {
      parts.push(`can't check the ${unplaced.map((d) => d.label).join(', ')} - not placed yet`);
    }
    if (unreachable.length > 0) {
      parts.push(`the ${unreachable.map((d) => d.label).join(', ')} ${unreachable.length === 1 ? 'is' : 'are'} NOT reachable no matter what order the other tools/dungeons are obtained in`);
    }
    finalStatusText = `❌ ${parts.join('; ')} — magenta tiles on the map mark exactly where the path is blocked.`;
    finalStatusClass = 'fail';
  } else {
    // Superboss markers aren't part of the tool-gated progression chain above
    // (they don't unlock anything further, so there's no "stage order" to
    // check them against) - each one just needs to be reachable once every
    // tool is in hand, checked here against tooledReached directly rather
    // than folded into checkProgression's staged entrances list. Only placed
    // markers are checked - an unplaced one (screenId still null) has nothing
    // to verify yet, same as the tool-dungeon "hasn't been placed yet" case
    // above.
    const unreachableSuperBosses = [];
    for (const [superBossId, pos] of Object.entries(superBossMarkers)) {
      if (!pos.screenId) continue;
      const world = worldKeyFor(pos);
      if (!world || !tooledReached.has(`${world.x},${world.y}`)) {
        unreachableSuperBosses.push(superBossId);
      }
    }

    if (unreachableSuperBosses.length > 0) {
      const verb = unreachableSuperBosses.length === 1 ? 'is' : 'are';
      finalStatusText = `❌ ${unreachableSuperBosses.join(', ')} ${verb} NOT reachable even with every tool — red tiles on the map mark what's cut off.`;
      finalStatusClass = 'fail';
    } else {
      // What actually matters (Timothy's own bar): can the player navigate,
      // get the treasure/tools, and reach the dragon - not "is literally
      // every grass tile in the world reachable." The entrance chain above is
      // the real check; isolated pockets elsewhere are still visibly tinted
      // red on the map (nothing hidden) but aren't treated as a failure here
      // unless something is actually placed there.
      finalStatusText = '✅ Full progression is soundly gated: axe, pick, canoe (boat), portal and dragon dungeons all become reachable through some valid order of getting tools — and every placed superboss is reachable with every tool.';
      finalStatusClass = 'ok';
    }
  }

  status.textContent = '🔎 Checking…';
  status.className = '';

  const speedSlider = document.getElementById('checkMapSpeed');
  const settledFree = new Set(); // wave 0 (toolless) tiles - no tint, freely reachable
  const settledToolGated = new Set(); // later-wave tiles - yellow tint, tool-gated
  const exploring = new Set(); // the wave currently animating in
  let waveIndex = 0;
  let order = [];
  let cursor = 0;

  function startWave() {
    if (myAnimId !== wildernessCheckAnimId) return; // superseded by a later check, an edit, or a marker move
    if (waveIndex >= result.passes.length) {
      checkOverlay = finalOverlay;
      status.textContent = finalStatusText;
      status.className = finalStatusClass;
      render(ctx);
      return;
    }
    const previouslyReached = waveIndex === 0 ? new Set() : result.passes[waveIndex - 1];
    order = [...result.passes[waveIndex]].filter((key) => !previouslyReached.has(key));
    cursor = 0;
    exploring.clear();
    if (order.length === 0) {
      waveIndex++;
      startWave();
      return;
    }
    requestAnimationFrame(step);
  }

  function step() {
    if (myAnimId !== wildernessCheckAnimId) return;
    const tilesPerFrame = Math.max(1, Number(speedSlider.value) || 1);
    const end = Math.min(order.length, cursor + tilesPerFrame);
    for (; cursor < end; cursor++) exploring.add(order[cursor]);
    checkOverlay = { phase: 'animating', settledFree, settledToolGated, exploring };
    render(ctx);
    if (cursor < order.length) {
      requestAnimationFrame(step);
      return;
    }
    const target = waveIndex === 0 ? settledFree : settledToolGated;
    for (const key of order) target.add(key);
    waveIndex++;
    setTimeout(startWave, 400);
  }

  startWave();
}

// Dungeon-interior maps have no tool-gating at all (unlike the wilderness),
// so this is far simpler than checkMap() above: one flood-fill from the
// door/entrance tile, then every walkable tile in the map must be in that
// reached set - exactly what tests/superBosses.test.js's assertFullyReachable
// enforces at the file level (see 'exit'/'guardian' walkable flags in
// js/tiles.js), just runnable live in the editor instead of via npm test
// after the fact. This is what would have caught superBossFive's
// disconnected-tile bug.
function findDungeonStart(grid, w, h) {
  const starts = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] === 'exit' || grid[y][x] === 'miniDungeonEntrance') starts.push({ x, y });
    }
  }
  return starts;
}

// The verdict (unreached, ok/fail) is decided synchronously below, same as
// before Task 15's animation was added - only the on-screen reveal of
// `reached` is animated, at a rate the speed slider controls (tiles
// revealed per frame). `reached` is a Set, and Sets iterate in insertion
// order in JS, which for floodFillReachable IS the BFS discovery order -
// so replaying `[...reached]` is literally "replay the path being checked,"
// no separate order-tracking needed.
function checkDungeonMap(ctx) {
  const status = document.getElementById('dungeonCheckStatus');
  const { grid, w, h } = getActive();
  dungeonCheckAnimId++;
  const myAnimId = dungeonCheckAnimId;

  const starts = findDungeonStart(grid, w, h);
  if (starts.length !== 1) {
    dungeonCheckOverlay = null;
    status.textContent = starts.length === 0
      ? "⚠️ No door/entrance tile ('exit' or 'miniDungeonEntrance') found - place one before checking."
      : `⚠️ Found ${starts.length} door/entrance tiles - there should be exactly one to check from.`;
    status.className = 'fail';
    return;
  }

  const isPassable = (x, y) => Boolean(TILES[grid[y][x]] && TILES[grid[y][x]].walkable);
  const reached = floodFillReachable(w, h, starts[0], isPassable);

  const unreached = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = `${x},${y}`;
      if (isPassable(x, y) && !reached.has(key)) unreached.add(key);
    }
  }

  const order = [...reached];
  const revealed = new Set();
  let cursor = 0;
  status.textContent = '🔎 Checking…';
  status.className = '';

  const speedSlider = document.getElementById('dungeonCheckSpeed');
  function step() {
    if (myAnimId !== dungeonCheckAnimId) return; // superseded by a later check, an edit, or a map switch
    const tilesPerFrame = Math.max(1, Number(speedSlider.value) || 1);
    const end = Math.min(order.length, cursor + tilesPerFrame);
    for (; cursor < end; cursor++) revealed.add(order[cursor]);
    dungeonCheckOverlay = { phase: 'animating', revealed };
    render(ctx);
    if (cursor < order.length) {
      requestAnimationFrame(step);
      return;
    }

    dungeonCheckOverlay = { phase: 'done', unreached };
    if (unreached.size > 0) {
      status.textContent = `❌ ${unreached.size} walkable tile(s) are unreachable from the door - magenta tiles on the map mark exactly which ones.`;
      status.className = 'fail';
    } else {
      status.textContent = '✅ Every walkable tile is reachable from the door.';
      status.className = 'ok';
    }
    render(ctx);
  }
  requestAnimationFrame(step);
}

async function init() {
  const canvas = document.getElementById('worldCanvas');
  const ctx = canvas.getContext('2d');
  const autosaveStatus = document.getElementById('autosaveStatus');
  const wildernessOnlyEls = document.querySelectorAll('.wilderness-only');
  const singleMapOnlyEls = document.querySelectorAll('.single-map-only');
  const newDungeonOnlyEls = document.querySelectorAll('.new-dungeon-only');
  const paletteDiv = document.getElementById('palette');
  const exportSelect = document.getElementById('exportSelect');

  const savedRaw = loadAutosave();
  const savedSingleMaps = (savedRaw && savedRaw.singleMaps) || {};

  if (savedRaw && savedRaw.grid) {
    grid = savedRaw.grid;
    dungeonMarker = savedRaw.dungeonMarker;
    toolDungeonMarkers = savedRaw.toolDungeonMarkers || {};
    superBossMarkers = savedRaw.superBossMarkers || {};
    autosaveStatus.textContent = 'Restored unsaved changes from your last session.';
    unsavedChangeCount = 1; // exact count from the previous session is unknown, but it's definitely not zero
  } else {
    grid = await loadAllScreens();
  }
  if (!dungeonMarker) {
    const stateMod = await import('../../js/state.js');
    dungeonMarker = { ...stateMod.DEFAULT_DUNGEON_ENTRANCE_POSITION };
  }
  if (Object.keys(toolDungeonMarkers).length === 0) {
    const toolDungeonsMod = await import('../../js/data/toolDungeons.js');
    for (const toolId of TOOL_DUNGEON_IDS) {
      const entry = toolDungeonsMod.TOOL_DUNGEON_ENTRANCES[toolId];
      toolDungeonMarkers[toolId] = { screenId: entry.screenId, x: entry.x, y: entry.y };
    }
  }
  // Superboss ids are data-driven (unlike TOOL_DUNGEON_IDS' fixed 4), so
  // SUPER_BOSS_IDS is captured here from whatever's currently in the
  // registry and reused below to populate the mode-select dropdown.
  const superBossesMod = await import('../../js/data/superBosses.js');
  const SUPER_BOSS_IDS = Object.keys(superBossesMod.SUPER_BOSSES);
  if (Object.keys(superBossMarkers).length === 0) {
    for (const superBossId of SUPER_BOSS_IDS) {
      const entry = superBossesMod.SUPER_BOSSES[superBossId];
      superBossMarkers[superBossId] = { screenId: entry.screenId, x: entry.x, y: entry.y, hasDungeon: entry.hasDungeon };
    }
  }
  // Every real superboss dungeon file so far (superBossOneDungeon.js through
  // superBossFive.js) follows dungeonMapId's own naming exactly -
  // `js/maps/superBosses/${dungeonMapId}.js` exporting `${dungeonMapId}Map` -
  // and paints with the same caveFloor/caveWall/exit/guardian palette "New
  // Dungeon" mode uses. Without this, none of these existing files were
  // selectable in the Map dropdown at all (only a brand-new dungeon created
  // via "New Dungeon" in that same browser session was, since that button's
  // handler is the only other thing that ever adds to SINGLE_MAPS, and it's
  // lost on reload) - so neither the order-independent progression check
  // nor the new dungeon-interior Check Map could actually be pointed at
  // superBossFive's known-broken map without this. Deliberately NOT
  // isNewDungeon - these files already exist, so they use the same
  // Copy-LEGEND/ROWS-and-paste-by-hand save path every other existing
  // single map (dragon/tool dungeons, mini-dungeons) already uses, not
  // "Save New Dungeon to Server."
  for (const superBossId of SUPER_BOSS_IDS) {
    const entry = superBossesMod.SUPER_BOSSES[superBossId];
    if (!entry.hasDungeon || !entry.dungeonMapId || SINGLE_MAPS[entry.dungeonMapId]) continue;
    SINGLE_MAPS[entry.dungeonMapId] = {
      label: `${superBossId}'s dungeon (${entry.dungeonMapId})`,
      modulePath: `../../js/maps/superBosses/${entry.dungeonMapId}.js`,
      exportName: `${entry.dungeonMapId}Map`,
      palette: NEW_DUNGEON_PALETTE,
      defaultKind: 'caveFloor',
    };
  }
  updateUnsavedIndicator();

  const dungeonReadout = document.getElementById('dungeonReadout');
  function updateDungeonReadout() {
    dungeonReadout.textContent = dungeonMarker
      ? `${dungeonMarker.screenId} (${dungeonMarker.x}, ${dungeonMarker.y})`
      : 'not set';
  }

  const toolDungeonSelect = document.getElementById('toolDungeonSelect');
  const toolDungeonReadout = document.getElementById('toolDungeonReadout');
  function updateToolDungeonReadout() {
    const pos = toolDungeonMarkers[toolDungeonSelect.value];
    toolDungeonReadout.textContent = pos ? `${pos.screenId} (${pos.x}, ${pos.y})` : 'not set';
  }
  for (const toolId of TOOL_DUNGEON_IDS) {
    const opt = document.createElement('option');
    opt.value = toolId;
    opt.textContent = toolId;
    toolDungeonSelect.appendChild(opt);
  }
  toolDungeonSelect.addEventListener('change', updateToolDungeonReadout);

  const superBossSelect = document.getElementById('superBossSelect');
  const superBossHasDungeonCheckbox = document.getElementById('superBossHasDungeonCheckbox');
  const superBossReadout = document.getElementById('superBossReadout');
  function updateSuperBossReadout() {
    const pos = superBossMarkers[superBossSelect.value];
    superBossReadout.textContent = pos ? `${pos.screenId} (${pos.x}, ${pos.y}) hasDungeon=${pos.hasDungeon}` : 'not set';
  }
  for (const superBossId of SUPER_BOSS_IDS) {
    const opt = document.createElement('option');
    opt.value = superBossId;
    opt.textContent = superBossId;
    superBossSelect.appendChild(opt);
  }
  superBossSelect.addEventListener('change', updateSuperBossReadout);

  // "New Dungeon" mode's optional hook-up-to-a-superboss dropdown (see
  // saveNewDungeonBtn below) - same SUPER_BOSS_IDS list as superBossSelect
  // above, kept as a separate <select> since the two live in different
  // control groups (wilderness-only vs. new-dungeon-only) and serve
  // different purposes (placing a marker vs. saving a dungeon file).
  const hookUpSuperBossSelect = document.getElementById('hookUpSuperBossSelect');
  for (const superBossId of SUPER_BOSS_IDS) {
    const opt = document.createElement('option');
    opt.value = superBossId;
    opt.textContent = superBossId;
    hookUpSuperBossSelect.appendChild(opt);
  }

  function currentPalette() {
    return currentMapKey === 'wilderness' ? WILDERNESS_PALETTE : SINGLE_MAPS[currentMapKey].palette;
  }

  function rebuildPalette() {
    paletteDiv.innerHTML = '';
    const kinds = currentPalette();
    for (const kind of kinds) {
      const btn = document.createElement('button');
      btn.dataset.kind = kind;
      btn.textContent = PALETTE_ICONS[kind] || kind;
      btn.title = PALETTE_LABELS[kind] || kind;
      btn.addEventListener('click', () => {
        activeBrush = kind;
        paletteDiv.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
      paletteDiv.appendChild(btn);
    }
    activeBrush = kinds[0];
    paletteDiv.querySelector('button').classList.add('active');
  }

  function setModeVisibility() {
    const isWilderness = currentMapKey === 'wilderness';
    wildernessOnlyEls.forEach((el) => { el.style.display = isWilderness ? '' : 'none'; });
    singleMapOnlyEls.forEach((el) => { el.style.display = isWilderness ? 'none' : ''; });
  }

  async function switchMap(key) {
    currentMapKey = key;
    dungeonCheckOverlay = null; // stale as soon as a different map is loaded
    dungeonCheckAnimId++;
    document.getElementById('dungeonCheckStatus').textContent = '';
    document.getElementById('dungeonCheckStatus').className = '';
    updateExportBtnLabel();
    setModeVisibility();
    // Gated separately from setModeVisibility's wilderness-vs-single-map
    // split - "Save New Dungeon to Server" only makes sense for a
    // SINGLE_MAPS entry created via the "New Dungeon" button (isNewDungeon:
    // true, Task 12), never for an existing single map like the dragon
    // dungeon or a mini-dungeon variant that already has its own file.
    const isNewDungeon = key !== 'wilderness' && Boolean(SINGLE_MAPS[key] && SINGLE_MAPS[key].isNewDungeon);
    newDungeonOnlyEls.forEach((el) => { el.style.display = isNewDungeon ? '' : 'none'; });
    rebuildPalette();
    if (key === 'wilderness') {
      canvas.width = WORLD_W * CELL;
      canvas.height = WORLD_H * CELL;
      updateDungeonReadout();
      updateToolDungeonReadout();
      updateSuperBossReadout();
    } else {
      const cached = savedSingleMaps[key];
      const loaded = cached ? { grid: cached, w: cached[0].length, h: cached.length } : await loadSingleMap(key);
      singleGrid = loaded.grid;
      singleMapW = loaded.w;
      singleMapH = loaded.h;
      canvas.width = singleMapW * CELL;
      canvas.height = singleMapH * CELL;
    }
    render(ctx);
  }

  const mapSelect = document.getElementById('mapSelect');
  const wildernessOpt = document.createElement('option');
  wildernessOpt.value = 'wilderness';
  wildernessOpt.textContent = 'Wilderness (5x5 world)';
  mapSelect.appendChild(wildernessOpt);
  for (const [key, def] of Object.entries(SINGLE_MAPS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = def.label;
    mapSelect.appendChild(opt);
  }
  mapSelect.addEventListener('change', () => switchMap(mapSelect.value));

  // "New Dungeon" (Task 12) - starts a blank paintable dungeon interior
  // from scratch, for a superboss's own dungeon, instead of only ever
  // being able to load+edit an existing map file. Registers a new
  // SINGLE_MAPS entry at runtime and primes switchMap's own cache
  // (savedSingleMaps) with the blank grid so switchMap picks it up
  // exactly like an already-in-progress edit - it never calls
  // loadSingleMap, since there's no file to load yet.
  document.getElementById('newDungeonBtn').addEventListener('click', async () => {
    const id = prompt('New dungeon map id (must be a legal JS identifier - becomes both the exported const name and the Map dropdown key, e.g. "shadowKeepDungeon"):');
    if (id === null) return; // cancelled
    if (!JS_IDENTIFIER_RE.test(id)) {
      alert(`"${id}" isn't a legal JS identifier (letters/digits/_/$ only, can't start with a digit).`);
      return;
    }
    if (SINGLE_MAPS[id] || id === 'wilderness') {
      alert(`"${id}" is already in use - pick a different id.`);
      return;
    }
    const widthRaw = prompt('Width in cells:', '14');
    if (widthRaw === null) return;
    const heightRaw = prompt('Height in cells:', '8');
    if (heightRaw === null) return;
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      alert('Width and height must be positive whole numbers.');
      return;
    }

    SINGLE_MAPS[id] = {
      label: `${id} (new)`,
      palette: NEW_DUNGEON_PALETTE,
      defaultKind: 'caveFloor',
      isNewDungeon: true, // Task 13's server creates a file here instead of patching one
    };
    savedSingleMaps[id] = Array(height).fill(null).map(() => Array(width).fill('caveFloor'));

    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = SINGLE_MAPS[id].label;
    mapSelect.appendChild(opt);
    mapSelect.value = id;

    undoStacks[id] = [];
    await switchMap(id);
    saveAutosave();
    markDirty();
    autosaveStatus.textContent = `Created new blank dungeon "${id}" (${width}x${height}).`;
  });

  await switchMap('wilderness');

  document.getElementById('resetFromFilesBtn').addEventListener('click', async () => {
    if (!confirm('Discard all unexported changes on the current map and reload the real file from disk?')) return;
    if (currentMapKey !== 'wilderness' && SINGLE_MAPS[currentMapKey].isNewDungeon) {
      autosaveStatus.textContent = 'This is a brand-new dungeon with no file on disk yet - nothing to reset from.';
      return;
    }
    if (currentMapKey === 'wilderness') {
      grid = await loadAllScreens();
      const stateMod = await import('../../js/state.js');
      dungeonMarker = { ...stateMod.DEFAULT_DUNGEON_ENTRANCE_POSITION };
      updateDungeonReadout();
      const toolDungeonsMod = await import('../../js/data/toolDungeons.js');
      for (const toolId of TOOL_DUNGEON_IDS) {
        const entry = toolDungeonsMod.TOOL_DUNGEON_ENTRANCES[toolId];
        toolDungeonMarkers[toolId] = { screenId: entry.screenId, x: entry.x, y: entry.y };
      }
      updateToolDungeonReadout();
      const superBossesMod = await import('../../js/data/superBosses.js');
      for (const superBossId of Object.keys(superBossesMod.SUPER_BOSSES)) {
        const entry = superBossesMod.SUPER_BOSSES[superBossId];
        superBossMarkers[superBossId] = { screenId: entry.screenId, x: entry.x, y: entry.y, hasDungeon: entry.hasDungeon };
      }
      updateSuperBossReadout();
    } else {
      const loaded = await loadSingleMap(currentMapKey);
      singleGrid = loaded.grid;
      singleMapW = loaded.w;
      singleMapH = loaded.h;
      delete savedSingleMaps[currentMapKey];
    }
    undoStacks[currentMapKey] = []; // a freshly-reloaded map has nothing sensible left to undo into
    saveAutosave();
    clearDirty(); // now matches disk again - discarded whatever was unsaved
    autosaveStatus.textContent = 'Reloaded from files.';
    render(ctx);
  });

  function doUndo() {
    if (!undo()) return;
    updateDungeonReadout();
    updateToolDungeonReadout();
    updateSuperBossReadout();
    saveAutosave();
    markDirty();
    render(ctx);
  }
  document.getElementById('undoBtn').addEventListener('click', doUndo);
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.key === '[' || e.key === ']') {
      const next = Math.min(Number(brushSizeInput.max), Math.max(Number(brushSizeInput.min), brushSize + (e.key === ']' ? 1 : -1)));
      if (next === brushSize) return;
      brushSize = next;
      brushSizeInput.value = String(brushSize);
      brushSizeLabel.textContent = String(brushSize);
      render(ctx);
    }
  });

  const placeDungeonBtn = document.getElementById('placeDungeonBtn');
  const placeToolDungeonBtn = document.getElementById('placeToolDungeonBtn');
  const placeSuperBossBtn = document.getElementById('placeSuperBossBtn');
  placeDungeonBtn.addEventListener('click', () => {
    placingDungeon = !placingDungeon;
    placingToolDungeon = null;
    placingSuperBoss = null;
    placeToolDungeonBtn.classList.remove('active');
    placeSuperBossBtn.classList.remove('active');
    placeDungeonBtn.classList.toggle('active', placingDungeon);
    canvas.classList.toggle('placing-dungeon', placingDungeon);
  });

  document.getElementById('copyDungeonBtn').addEventListener('click', async () => {
    if (!dungeonMarker) return;
    const text = `{ screenId: '${dungeonMarker.screenId}', x: ${dungeonMarker.x}, y: ${dungeonMarker.y} }`;
    try {
      await navigator.clipboard.writeText(text);
      autosaveStatus.textContent = `Copied: ${text}`;
    } catch (err) {
      autosaveStatus.textContent = `Clipboard blocked - copy manually: ${text}`;
    }
  });

  placeToolDungeonBtn.addEventListener('click', () => {
    placingToolDungeon = placingToolDungeon ? null : toolDungeonSelect.value;
    placingDungeon = false;
    placingSuperBoss = null;
    placeDungeonBtn.classList.remove('active');
    placeSuperBossBtn.classList.remove('active');
    placeToolDungeonBtn.classList.toggle('active', Boolean(placingToolDungeon));
    canvas.classList.toggle('placing-dungeon', Boolean(placingToolDungeon));
  });

  document.getElementById('copyToolDungeonBtn').addEventListener('click', async () => {
    const pos = toolDungeonMarkers[toolDungeonSelect.value];
    if (!pos) return;
    const text = `{ screenId: '${pos.screenId}', x: ${pos.x}, y: ${pos.y} }`;
    try {
      await navigator.clipboard.writeText(text);
      autosaveStatus.textContent = `Copied: ${text}`;
    } catch (err) {
      autosaveStatus.textContent = `Clipboard blocked - copy manually: ${text}`;
    }
  });

  placeSuperBossBtn.addEventListener('click', () => {
    placingSuperBoss = placingSuperBoss ? null : superBossSelect.value;
    placingDungeon = false;
    placingToolDungeon = null;
    placeDungeonBtn.classList.remove('active');
    placeToolDungeonBtn.classList.remove('active');
    placeSuperBossBtn.classList.toggle('active', Boolean(placingSuperBoss));
    canvas.classList.toggle('placing-dungeon', Boolean(placingSuperBoss));
  });

  document.getElementById('copySuperBossBtn').addEventListener('click', async () => {
    const pos = superBossMarkers[superBossSelect.value];
    if (!pos) return;
    const text = `{ screenId: '${pos.screenId}', x: ${pos.x}, y: ${pos.y}, hasDungeon: ${pos.hasDungeon} }`;
    try {
      await navigator.clipboard.writeText(text);
      autosaveStatus.textContent = `Copied: ${text}`;
    } catch (err) {
      autosaveStatus.textContent = `Clipboard blocked - copy manually: ${text}`;
    }
  });

  document.getElementById('checkMapBtn').addEventListener('click', () => {
    checkMap(ctx);
  });

  document.getElementById('checkDungeonMapBtn').addEventListener('click', () => {
    checkDungeonMap(ctx);
  });

  document.getElementById('jumpToExportBtn').addEventListener('click', async () => {
    const target = currentMapKey === 'wilderness'
      ? document.getElementById('exportAllBtn')
      : document.getElementById('exportRow');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('export-flash');
    setTimeout(() => target.classList.remove('export-flash'), 1300);
    // When the click can just save straight to disk, do that too instead of
    // making the user scroll down and click a second button - the scroll is
    // still worth doing so they can see the result land.
    if (canSaveSingleMapToServer()) await performExportOrSave();
  });

  const brushSizeInput = document.getElementById('brushSize');
  const brushSizeLabel = document.getElementById('brushSizeLabel');
  brushSizeInput.addEventListener('input', () => {
    brushSize = Number(brushSizeInput.value);
    brushSizeLabel.textContent = String(brushSize);
  });

  document.querySelectorAll('#brushShape button').forEach((btn) => {
    btn.addEventListener('click', () => {
      brushShape = btn.dataset.shape;
      document.querySelectorAll('#brushShape button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelector('#brushShape button[data-shape="square"]').classList.add('active');

  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / CELL),
      y: Math.floor((e.clientY - rect.top) / CELL),
    };
  }

  // Trackpad two-finger scroll fires as a `wheel` event on desktop Chrome/
  // Firefox (not a touch event), so it isn't stopped by touch-action - it
  // scrolls the page mid-stroke, shifting the canvas under the cursor while
  // painting. Only suppress it during an active stroke so scrolling to see
  // the rest of the map still works between strokes.
  canvas.addEventListener('wheel', (e) => {
    if (painting) e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = cellFromEvent(e);
    if (currentMapKey === 'wilderness' && placingDungeon) {
      pushUndoSnapshot();
      const local = worldToLocal(x, y);
      if (local) {
        dungeonMarker = local;
        updateDungeonReadout();
        checkOverlay = null; wildernessCheckAnimId++; // stale as soon as the marker moves
        saveAutosave();
        markDirty();
      }
      placingDungeon = false;
      placeDungeonBtn.classList.remove('active');
      canvas.classList.remove('placing-dungeon');
      render(ctx);
      return;
    }
    if (currentMapKey === 'wilderness' && placingToolDungeon) {
      pushUndoSnapshot();
      const local = worldToLocal(x, y);
      if (local) {
        toolDungeonMarkers[placingToolDungeon] = local;
        updateToolDungeonReadout();
        checkOverlay = null; wildernessCheckAnimId++; // stale as soon as a marker moves
        saveAutosave();
        markDirty();
      }
      placingToolDungeon = null;
      placeToolDungeonBtn.classList.remove('active');
      canvas.classList.remove('placing-dungeon');
      render(ctx);
      return;
    }
    if (currentMapKey === 'wilderness' && placingSuperBoss) {
      pushUndoSnapshot();
      const local = worldToLocal(x, y);
      if (local) {
        superBossMarkers[placingSuperBoss] = { ...local, hasDungeon: superBossHasDungeonCheckbox.checked };
        updateSuperBossReadout();
        checkOverlay = null; wildernessCheckAnimId++; // stale as soon as a marker moves
        saveAutosave();
        markDirty();
      }
      placingSuperBoss = null;
      placeSuperBossBtn.classList.remove('active');
      canvas.classList.remove('placing-dungeon');
      render(ctx);
      return;
    }
    pushUndoSnapshot();
    painting = true;
    paintBrush(x, y);
    render(ctx);
  });
  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = cellFromEvent(e);
    const validBrush = currentPalette().includes(activeBrush);
    hoverCell = validBrush ? { x, y } : null;
    if (painting && validBrush) paintBrush(x, y);
    render(ctx);
  });
  canvas.addEventListener('mouseleave', () => {
    hoverCell = null;
    render(ctx);
  });
  window.addEventListener('mouseup', () => {
    // Autosave once per stroke (not per mousemove) - JSON-serializing a large
    // grid on every pixel of a drag would be needlessly slow.
    if (painting) { saveAutosave(); markDirty(); }
    painting = false;
  });

  for (const id of Object.keys(GRID_LAYOUT)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    exportSelect.appendChild(opt);
  }

  document.getElementById('exportBtn').addEventListener('click', performExportOrSave);

  const repoStatus = document.getElementById('repoStatus');
  const chooseRepoBtn = document.getElementById('chooseRepoBtn');
  const exportAllBtn = document.getElementById('exportAllBtn');
  const exportAllStatus = document.getElementById('exportAllStatus');

  // Feature-detect the Node authoring server (Task 13) before falling back
  // to the older File System Access flow - see checkServerAvailable's own
  // comment for why an OPTIONS preflight is what distinguishes "server
  // running" from "no server, or a plain static file server."
  serverAvailable = await checkServerAvailable();
  updateExportBtnLabel();

  if (serverAvailable) {
    chooseRepoBtn.style.display = 'none';
    repoStatus.textContent = 'Using the local authoring server (node tools/terrain-painter/server.js) — writes go straight to disk, no folder picker needed.';
    exportAllBtn.addEventListener('click', async () => {
      exportAllStatus.textContent = 'Writing…';
      try {
        exportAllStatus.textContent = await exportAllToServer();
        clearDirty();
      } catch (err) {
        exportAllStatus.textContent = `Failed: ${err.message}`;
      }
    });
  } else if (!window.showDirectoryPicker) {
    repoStatus.textContent = 'Not supported in this browser (start the Node authoring server, or use Chrome/Edge for the folder-picker fallback) — use "Copy LEGEND/ROWS" per screen instead.';
    chooseRepoBtn.disabled = true;
    exportAllBtn.disabled = true;
  } else {
    chooseRepoBtn.addEventListener('click', async () => {
      try {
        const name = await pickRepoDirectory();
        repoStatus.textContent = `Writing straight to: ${name}/`;
      } catch (err) {
        if (err.name !== 'AbortError') repoStatus.textContent = `Could not use that folder: ${err.message}`;
      }
    });

    exportAllBtn.addEventListener('click', async () => {
      exportAllStatus.textContent = 'Writing…';
      try {
        exportAllStatus.textContent = await exportAllToFiles();
        clearDirty();
      } catch (err) {
        exportAllStatus.textContent = `Failed: ${err.message}`;
      }
    });
  }

  // "Save New Dungeon to Server" (Task 13) - the one save path a brand-new
  // dungeon (Task 12's "New Dungeon" mode) actually needs: there's no
  // existing file to patch, so this is server-only (the create-dungeon
  // endpoint), with no File System Access fallback offered - createFile()-
  // via-FSA-with-a-user-picked-parent-directory would be a second, mostly-
  // redundant code path for what should be a rare authoring action.
  const saveNewDungeonBtn = document.getElementById('saveNewDungeonBtn');
  const saveNewDungeonStatus = document.getElementById('saveNewDungeonStatus');
  saveNewDungeonBtn.addEventListener('click', async () => {
    const def = SINGLE_MAPS[currentMapKey];
    if (!def || !def.isNewDungeon) return; // button's own visibility already guards this; belt-and-suspenders against a stale click mid-mode-switch
    if (!serverAvailable) {
      alert('Saving a new dungeon needs the Node authoring server running (node tools/terrain-painter/server.js) - there is no existing file to patch, so there is no File System Access fallback for this action.');
      return;
    }

    // Multiple `exit` tiles are fine (raised 2026-09-13 - superBossThree's
    // dungeon wants two doors, either usable to leave, only one as the
    // actual spawn) - js/main.js's exitMap handler doesn't look at which
    // specific exit tile the player is standing on at all, it just returns
    // them to this dungeon's own wilderness entrance, so any number already
    // works correctly in the real game. Only startPosition needs picking:
    // the first exit tile in scan order, same as tests/superBosses.test.js's
    // own tolerant assertion (start tile must be tagged 'exit', not "the
    // only one").
    let exitPos = null;
    let exitCount = 0;
    let guardianCount = 0;
    for (let y = 0; y < singleMapH; y++) {
      for (let x = 0; x < singleMapW; x++) {
        if (singleGrid[y][x] === 'exit') { exitCount++; if (!exitPos) exitPos = { x, y }; }
        if (singleGrid[y][x] === 'guardian') guardianCount++;
      }
    }
    if (exitCount < 1) {
      alert(`New dungeon needs at least one 'exit' tile placed (found ${exitCount}) - that's where the player starts.`);
      return;
    }
    if (guardianCount === 0) {
      alert(`New dungeon needs at least one 'guardian' tile placed - otherwise there's no fight in it at all.`);
      return;
    }

    const guardianMonsterId = prompt('Guardian monster id (a key from MONSTERS in js/data/monsters.js, e.g. "axeGuardian"):');
    if (guardianMonsterId === null) return; // cancelled
    if (!MONSTERS[guardianMonsterId]) {
      alert(`"${guardianMonsterId}" isn't a known monster id in js/data/monsters.js's MONSTERS.`);
      return;
    }

    // Optional hook-up, added after superBossTwo's dungeon needed a manual
    // dungeonMapId edit afterward (raised 2026-09-13) - "(none)" leaves that
    // link for the author to add by hand, same as every dungeon before this
    // dropdown existed. superBossesMod.SUPER_BOSSES is the snapshot loaded
    // at page init, not re-fetched here - fine for a same-session "already
    // has a different dungeon" warning, since re-linking one boss's dungeon
    // to a different map file mid-session is exactly the rare case worth
    // asking about, not something to silently overwrite.
    const hookUpSuperBossId = hookUpSuperBossSelect.value || null;
    let hookUpSuperBoss = null;
    if (hookUpSuperBossId) {
      const existing = superBossesMod.SUPER_BOSSES[hookUpSuperBossId];
      if (existing.dungeonMapId && existing.dungeonMapId !== currentMapKey) {
        const proceed = confirm(`${hookUpSuperBossId} already has a dungeon ('${existing.dungeonMapId}'). Replace it with '${currentMapKey}'?`);
        if (!proceed) return;
      }
      const marker = superBossMarkers[hookUpSuperBossId];
      hookUpSuperBoss = { id: hookUpSuperBossId, screenId: marker.screenId, x: marker.x, y: marker.y };
    }

    saveNewDungeonStatus.textContent = 'Saving…';
    try {
      await postJson('/api/create-dungeon', {
        mapId: currentMapKey,
        legendRowsText: exportSingleMap(),
        startX: exitPos.x,
        startY: exitPos.y,
        guardianMonsterId,
        hookUpSuperBoss,
      });
      if (hookUpSuperBossId) {
        // Keep the in-memory marker (and its color on the wilderness canvas)
        // in sync without a reload - dungeonMapId itself isn't tracked
        // client-side (see patchSuperBossEntry's own comment in server.js),
        // only hasDungeon, which the canvas draw loop actually reads.
        superBossMarkers[hookUpSuperBossId].hasDungeon = true;
        superBossesMod.SUPER_BOSSES[hookUpSuperBossId].dungeonMapId = currentMapKey;
        superBossesMod.SUPER_BOSSES[hookUpSuperBossId].hasDungeon = true;
      }
      // The file now exists on disk and the server has registered it for
      // /api/patch-single-map this session (see handleCreateDungeon) - so
      // every save after this first one should go through the normal
      // "Save to Server" button instead of re-running this whole create-
      // dungeon flow (re-prompting for guardianMonsterId and rewriting the
      // whole file every time, raised 2026-09-13). Same visibility toggle
      // switchMap runs on mode-switch, just applied immediately instead of
      // waiting for the author to leave and come back to this map.
      def.isNewDungeon = false;
      newDungeonOnlyEls.forEach((el) => { el.style.display = 'none'; });
      updateExportBtnLabel();
      saveNewDungeonStatus.textContent = hookUpSuperBossId
        ? `Saved js/maps/superBosses/${currentMapKey}.js, registered it in js/main.js, and hooked it up to ${hookUpSuperBossId} in js/data/superBosses.js. Further saves will use "Save to Server" above.`
        : `Saved js/maps/superBosses/${currentMapKey}.js and registered it in js/main.js. Further saves will use "Save to Server" above.`;
      clearDirty();
    } catch (err) {
      saveNewDungeonStatus.textContent = `Failed: ${err.message}`;
    }
  });
}

init();
