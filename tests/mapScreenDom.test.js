// Real DOM tests for js/screens/mapScreen.js, using jsdom (see
// tests/helpers/dom.js). The map's only renderer is canvas (see
// mapCanvasRenderer.js) - jsdom has no canvas implementation at all
// (getContext('2d') returns null there), so nothing about actual pixel
// rendering is assertable here. This file is scoped to renderer-agnostic
// game logic instead: keydown -> action wiring, town exits, encounter
// cooldown, zone-1 step tracking, and gate crossing. The old DOM/CSS-Grid
// renderer's own rendering assertions (tile classes, z-index, fullsize
// markers, etc.) were removed along with it - their canvas equivalents live
// in tests/mapDrawList.test.js and tests/mapTrail.test.js, which assert the
// draw list (pure data) rather than DOM/pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, teardownDom, createRoot, keydown, keyup } from './helpers/dom.js';
import { createNewGame } from '../js/state.js';
import { townMap } from '../js/maps/townMap.js';
import { buildWorldGrid } from '../js/systems/worldGrid.js';
import { isGateCleared } from '../js/systems/toolGates.js';
import { TOWN_PORTAL_POSITION } from '../js/systems/portal.js';

function baseState(overrides = {}) {
  return { ...createNewGame(), position: { ...townMap.startPosition }, ...overrides };
}

async function mountTown(state) {
  const { mount } = await import('../js/screens/mapScreen.js');
  const root = createRoot();
  const maps = { town: townMap };
  mount(root, { state, mapConfig: townMap, maps, worldGrid: buildWorldGrid(maps), callbacks: { onFirstVisit: () => {} } });
  return root;
}

test('mapScreen DOM - portal pull effect delays the action', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('stepping onto the return portal plays the pull animation and delays enterPortalToOrigin, instead of firing it in the same tick', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    const maps = { town: townMap };
    const seenActions = [];
    // One tile below the fixed return-portal spot - ArrowUp steps onto it.
    const state = baseState({
      position: { x: TOWN_PORTAL_POSITION.x, y: TOWN_PORTAL_POSITION.y + 1 },
      portal: { originScreenId: 'north', originX: 3, originY: 3, returnPending: true },
    });
    mount(root, {
      state,
      mapConfig: townMap,
      maps,
      worldGrid: buildWorldGrid(maps),
      callbacks: { onFirstVisit: () => {}, onMove: () => {}, onAction: (action) => seenActions.push(action) },
    });

    keydown('ArrowUp');
    // Released before the wait below: a movement key counts as held until
    // keyup, and a held key keeps stepping on mapScreen's own walk timer.
    keyup('ArrowUp');
    assert.deepEqual(seenActions, [], 'expected enterPortalToOrigin to not fire in the same tick as the step');

    t.mock.timers.tick(500);
    assert.deepEqual(seenActions, ['enterPortalToOrigin']);
  });

  await t.test('a keypress during the pull window is ignored (guards against a stale delayed action firing after the player moved again)', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    const maps = { town: townMap };
    const seenActions = [];
    const state = baseState({
      position: { x: TOWN_PORTAL_POSITION.x, y: TOWN_PORTAL_POSITION.y + 1 },
      portal: { originScreenId: 'north', originX: 3, originY: 3, returnPending: true },
    });
    mount(root, {
      state,
      mapConfig: townMap,
      maps,
      worldGrid: buildWorldGrid(maps),
      callbacks: { onFirstVisit: () => {}, onMove: () => {}, onAction: (action) => seenActions.push(action) },
    });

    keydown('ArrowUp');
    keydown('ArrowDown');
    assert.equal(state.position.y, TOWN_PORTAL_POSITION.y, 'expected the second keypress to be ignored while a portal transition is pending, position unchanged');

    // Both released before the wait - see the note on the previous test.
    keyup('ArrowUp');
    keyup('ArrowDown');
    t.mock.timers.tick(500);
    assert.deepEqual(seenActions, ['enterPortalToOrigin'], 'expected exactly one delayed action, not a stale/duplicate fire');
  });
});

test('mapScreen DOM - portal hotkey', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('pressing P dispatches the usePortalTool action', async () => {
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    const maps = { town: townMap };
    const seenActions = [];
    mount(root, {
      state: baseState(),
      mapConfig: townMap,
      maps,
      worldGrid: buildWorldGrid(maps),
      callbacks: { onFirstVisit: () => {}, onAction: (action) => seenActions.push(action) },
    });
    keydown('p');
    assert.deepEqual(seenActions, ['usePortalTool']);
  });

  await t.test('pressing shift+P (uppercase P) also dispatches the usePortalTool action', async () => {
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    const maps = { town: townMap };
    const seenActions = [];
    mount(root, {
      state: baseState(),
      mapConfig: townMap,
      maps,
      worldGrid: buildWorldGrid(maps),
      callbacks: { onFirstVisit: () => {}, onAction: (action) => seenActions.push(action) },
    });
    keydown('P');
    assert.deepEqual(seenActions, ['usePortalTool']);
  });
});

// Old Safari-specific bug: a CSS Grid whose tracks size aspect-ratio
// children didn't reliably re-run its track-sizing pass on a live window
// resize - fixed long before the canvas rewrite by making the grid
// fixed-pixel-sized rather than 1fr-stretched. What's still worth guarding,
// independent of which renderer draws it, is that a resize triggers a fresh
// full rebuild rather than leaving the old viewport contents in place -
// render() rebuilds the whole viewport from scratch, so the canvas element
// itself gets replaced same as the old .map-grid did.
test('mapScreen DOM - resize triggers a fresh render', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('window resize replaces the mounted map canvas element', async () => {
    const root = await mountTown(baseState());
    const canvasBefore = root.querySelector('.map-canvas');
    assert.ok(canvasBefore, 'expected a .map-canvas element after mount');

    window.dispatchEvent(new Event('resize'));

    const canvasAfter = root.querySelector('.map-canvas');
    assert.ok(canvasAfter, 'expected a .map-canvas element to still exist after resize');
    assert.notEqual(canvasBefore, canvasAfter, 'expected resize to rebuild the map viewport element');
  });
});

test('mapScreen DOM - crossing a screen boundary onto a tool-gated tile', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('a single step across the boundary clears the mountain, same as any mid-screen step', async () => {
    const westScreen = {
      id: 'west',
      legend: { '.': 'grass' },
      rows: ['...', '...', '...'],
      neighbors: { east: 'east' },
      monsterTable: [],
      encounterChance: 0,
      cacheChance: 0,
    };
    // Left column is a mountain wall of 'M' tiles - x=0 is the tile
    // immediately across the shared boundary with `west`. Top/bottom rows
    // (y=0, y=2) are unused by this test but would render as mountainWall
    // regardless of legend content (isSealedWorldEdge - east has no
    // north/south neighbor), which is fine since the crossing happens on
    // the middle row (y=1).
    const eastScreen = {
      id: 'east',
      legend: { '.': 'grass', M: 'mountain' },
      rows: ['M..', 'M..', 'M..'],
      neighbors: { west: 'west' },
      monsterTable: [],
      encounterChance: 0,
      cacheChance: 0,
    };
    const maps = { west: westScreen, east: eastScreen };
    const worldGrid = buildWorldGrid(maps);
    // toolGateHintsShown is normally back-filled onto state by main.js's own
    // migration (see main.js), not part of createNewGame()'s defaults -
    // checkGateProximity (called at the end of every successful tryMove)
    // needs it present or it throws reading an undefined object.
    const state = baseState({
      position: { x: 2, y: 1 },
      inventory: [{ itemId: 'miningPick', quantity: 1 }],
      toolGateHintsShown: {},
    });

    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      state,
      mapConfig: westScreen,
      maps,
      worldGrid,
      callbacks: {
        onFirstVisit: () => {},
        onMove: () => {},
        onToolGateCleared: () => {},
        onLockedGate: () => {},
        onToolGateNearby: () => {},
        onAction: () => {},
        onEnterMiniDungeon: () => {},
        onCacheFound: () => {},
        onGateReward: () => {},
        onEncounter: () => {},
        onWornPathHint: () => {},
      },
    });

    // west is 3 tiles wide (x: 0..2); starting at x=2, one step east
    // resolves past west's own local bounds and onto east's (0, 1) - the
    // mountain tile - via worldGrid, not a teleport.
    keydown('ArrowRight');

    assert.equal(state.map, 'east', 'expected the current screen to swap to east after crossing the boundary');
    assert.equal(
      isGateCleared(state.clearedGates, 'east', 0, 1),
      true,
      'expected the mountain tile crossed into from another screen to be marked cleared, same as a mid-screen tool-gate crossing',
    );
  });
});

// Raised 2026-08-29: two random encounters back to back (fight, move one
// square, fight again) felt bad even though it's rare per-pair - nothing
// guaranteed a break after a fight ended. encounterChance: 1 below makes
// every eligible step fire if the cooldown isn't blocking it, isolating the
// cooldown's own on/off behavior from the underlying random roll.
test('mapScreen DOM - encounter cooldown blocks the next few steps after a random encounter', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('no repeat encounter for ENCOUNTER_COOLDOWN_STEPS steps, then rolls again', async () => {
    // 3 rows tall so the walked middle row (y=1) isn't itself a sealed
    // north/south world edge (isSealedWorldEdge treats a screen with no
    // neighbors as sealed on every side of its own bounding box); starting
    // at x=1 (not the sealed west edge) leaves x=2..5 as four movable,
    // non-edge interior steps for the four ArrowRight presses below.
    const plains = {
      id: 'plains',
      legend: { '.': 'grass' },
      rows: ['.......', '.......', '.......'],
      neighbors: {},
      monsterTable: ['boar'],
      encounterChance: 1,
      cacheChance: 0,
    };
    const maps = { plains };
    const worldGrid = buildWorldGrid(maps);
    const state = baseState({ position: { x: 1, y: 1 } });

    let encounterCount = 0;
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      state,
      mapConfig: plains,
      maps,
      worldGrid,
      callbacks: {
        onFirstVisit: () => {},
        onMove: () => {},
        onToolGateCleared: () => {},
        onLockedGate: () => {},
        onToolGateNearby: () => {},
        onAction: () => {},
        onEnterMiniDungeon: () => {},
        onCacheFound: () => {},
        onGateReward: () => {},
        onEncounter: () => { encounterCount += 1; },
        onWornPathHint: () => {},
      },
    });

    keydown('ArrowRight'); // move 1: fires, cooldown set to 2
    assert.equal(encounterCount, 1, 'expected the first step onto an always-fire tile to trigger an encounter');

    keydown('ArrowRight'); // move 2: cooldown 2 -> 1, blocked
    assert.equal(encounterCount, 1, 'expected the step right after an encounter to be blocked by the cooldown');

    keydown('ArrowRight'); // move 3: cooldown 1 -> 0, blocked
    assert.equal(encounterCount, 1, 'expected the second step after an encounter to still be blocked by the cooldown');

    keydown('ArrowRight'); // move 4: cooldown at 0, rolls again
    assert.equal(encounterCount, 2, 'expected the encounter roll to resume once the cooldown has fully counted down');
  });
});

test('mapScreen DOM - zone-1 step tracking', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('a step on a zone-1 wilderness screen increments state.zone1Steps', async () => {
    // 7 columns wide (not 3) so a single ArrowRight step from x=1 lands on
    // x=2, a genuine interior tile - a 3-wide row's x=2 is the sealed east
    // world edge (isSealedWorldEdge treats a screen with no neighbors as
    // sealed on every side of its own bounding box), which renders as an
    // impassable mountainWall and would silently block the move entirely
    // (same reasoning as the encounter-cooldown test's own `plains` fixture
    // above).
    const northScreen = {
      id: 'north',
      legend: { '.': 'grass' },
      rows: ['.......', '.......', '.......'],
      neighbors: {},
      monsterTable: [],
      encounterChance: 0,
      cacheChance: 0,
    };
    const maps = { north: northScreen };
    const worldGrid = buildWorldGrid(maps);
    // state.map must already match mapConfig.id here, same as it would in
    // real play (main.js keeps them in sync) - tryMove only re-syncs
    // state.map on an actual screen-boundary crossing, and this single-
    // screen synthetic map never crosses one, so without this override
    // state.map would stay stuck on createNewGame()'s 'center' default.
    const state = baseState({ position: { x: 1, y: 1 }, map: 'north' });
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      state, mapConfig: northScreen, maps, worldGrid,
      callbacks: {
        onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
        onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
        onGateReward: () => {}, onEncounter: () => {}, onWornPathHint: () => {},
      },
    });
    assert.equal(state.zone1Steps, 0);
    keydown('ArrowRight');
    assert.equal(state.zone1Steps, 1);
  });

  await t.test('a step on the town screen does not increment state.zone1Steps', async () => {
    // Same 7-wide rationale as the zone-1 screen above - keeps this a real
    // step onto an interior tile rather than a move silently blocked by the
    // sealed world edge, so the assertion actually exercises "a real step on
    // town doesn't increment" rather than "a blocked non-step doesn't".
    const centerScreen = {
      id: 'center',
      legend: { '.': 'grass' },
      rows: ['.......', '.......', '.......'],
      neighbors: {},
      monsterTable: [],
      encounterChance: 0,
      cacheChance: 0,
    };
    const maps = { center: centerScreen };
    const worldGrid = buildWorldGrid(maps);
    // 'center' already matches createNewGame()'s default state.map, but set
    // it explicitly for symmetry with the zone-1 test above rather than
    // relying on that coincidence.
    const state = baseState({ position: { x: 1, y: 1 }, map: 'center' });
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      state, mapConfig: centerScreen, maps, worldGrid,
      callbacks: {
        onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
        onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
        onGateReward: () => {}, onEncounter: () => {}, onWornPathHint: () => {},
      },
    });
    keydown('ArrowRight');
    assert.equal(state.zone1Steps, 0);
  });
});

test('mapScreen DOM - group encounter roll passes monsterTable/ngPlusCycle/zone1Steps through', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  await t.test('a forced encounter past the kill threshold can roll a mixed-species group', async () => {
    const originalRandom = Math.random;
    // Verified against a real run of this exact scenario (not just read from
    // source) - js/screens/mapScreen.js's tryMove makes/triggers Math.random()
    // calls in this exact order for one step onto a tile with tile.encounter
    // true: (1) js/systems/discovery.js's resolveStepDiscovery, mini-dungeon
    // check (mapConfig.miniDungeonChance is undefined below, so this always
    // misses regardless of the value rolled - still consumes one call), (2)
    // resolveStepDiscovery's cache check (cacheChance: 0 below, same deal -
        // always misses, still consumes one call), (3) the encounterChance roll
    // (must be < 1), (4) rollEliteEncounter's own roll
    // (js/systems/eliteEncounter.js, ELITE_ENCOUNTER_CHANCE = 0.05 - must
    // roll >= 0.05 to miss), (5) picking monsterId out of monsterTable
    // (floor(val * 3) into ['boar','bat','snake'] - 0.01 -> index 0, 'boar'),
    // then js/systems/groupEncounters.js's own rollEncounterGroup takes over:
    // (6) the group-spawn-chance roll (must be < 0.3 to hit), (7) the size
    // roll (0.99 -> the effective max, 4, since effectiveGroupSizeMax(0, 0)
    // = GROUP_SIZE_MAX_BASE = 4), then (8)-(10) one species pick per of the
    // 3 extra slots - 0.01/0.4/0.7 into the same 3-species table picks index
    // 0/1/2 ('boar'/'bat'/'snake'). Confirmed this sequence actually produces
    // ['boar', 'boar', 'bat', 'snake'] against Task 1 + this task's own
    // call-site change, both applied. monsterKillCounts is 20, not the bare
    // threshold of 10 - killCountSizeCap (js/systems/groupEncounters.js,
    // added 2026-09-04) pins a species' very first eligible encounter to
    // GROUP_SIZE_MIN regardless of the size roll, only reaching this test's
    // intended max of 4 once 10 kills past the threshold have landed.
    const sequence = [0.5, 0.5, 0.01, 0.99, 0.01, 0.01, 0.99, 0.01, 0.4, 0.7];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    try {
      const northScreen = {
        id: 'north',
        legend: { '.': 'grass' },
        rows: ['...', '...', '...'],
        neighbors: {},
        monsterTable: ['boar', 'bat', 'snake'],
        encounterChance: 1,
        cacheChance: 0,
      };
      const maps = { north: northScreen };
      const worldGrid = buildWorldGrid(maps);
      const state = baseState({
        position: { x: 0, y: 1 },
        monsterKillCounts: { boar: 20, bat: 20, snake: 20 },
      });
      const { mount } = await import('../js/screens/mapScreen.js');
      const root = createRoot();
      let encounteredIds = null;
      mount(root, {
        state, mapConfig: northScreen, maps, worldGrid,
        callbacks: {
          onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
          onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
          onGateReward: () => {}, onEncounter: (ids) => { encounteredIds = ids; }, onWornPathHint: () => {},
        },
      });
      keydown('ArrowRight');
      assert.ok(encounteredIds, 'expected an encounter to fire');
      assert.ok(encounteredIds.length > 1, 'expected a group, not a solo encounter');
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('ngPlusCycle and zone1Steps escalate the group size through to the real call site', async () => {
    const originalRandom = Math.random;
    // Verified by running this exact scenario against the real implementation.
    // Same call order as the "mixed-species group" test above:
    // (1) mini-dungeon check (always misses, miniDungeonChance undefined),
    // (2) cache check (always misses, cacheChance: 0), (3) encounterChance
    // (< 1), (4) elite roll (>= 0.05 to miss), (5) monsterId pick (0.01 ->
    // index 0, 'boar'), then rollEncounterGroup's own calls: (6) group-chance
    // roll (must be < groupSpawnChance(2) = 0.5), (7) size roll (0.99 ->
    // effectiveGroupSizeMax(2, 900) = min(6, 4 + 2 + floor(900/300)) = 6),
    // then (8)-(12) one species pick per of the 5 extra slots.
    // monsterKillCounts is 30, not the bare threshold of 10 -
    // killCountSizeCap (js/systems/groupEncounters.js, added 2026-09-04)
    // only reaches this test's intended max of 6 once 20 kills past the
    // threshold have landed (see that function's own comment).
    const sequence = [0.5, 0.5, 0.01, 0.99, 0.01, 0.01, 0.99, 0.01, 0.4, 0.7, 0.2, 0.99];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    try {
      const northScreen = {
        id: 'north',
        legend: { '.': 'grass' },
        rows: ['...', '...', '...'],
        neighbors: {},
        monsterTable: ['boar', 'bat', 'snake'],
        encounterChance: 1,
        cacheChance: 0,
      };
      const maps = { north: northScreen };
      const worldGrid = buildWorldGrid(maps);
      const state = baseState({
        position: { x: 0, y: 1 },
        monsterKillCounts: { boar: 30, bat: 30, snake: 30 },
        ngPlusCycle: 2,
        zone1Steps: 900,
      });
      const { mount } = await import('../js/screens/mapScreen.js');
      const root = createRoot();
      let encounteredIds = null;
      mount(root, {
        state, mapConfig: northScreen, maps, worldGrid,
        callbacks: {
          onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
          onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
          onGateReward: () => {}, onEncounter: (ids) => { encounteredIds = ids; }, onWornPathHint: () => {},
        },
      });
      keydown('ArrowRight');
      assert.ok(encounteredIds, 'expected an encounter to fire');
      assert.equal(encounteredIds.length, 6, 'ngPlusCycle=2 + zone1Steps=900 should reach the effective max of 6, not the baseline of 4');
    } finally {
      Math.random = originalRandom;
    }
  });
});

// See docs/superpowers/specs/2026-09-12-worn-path-encounter-discount-design.md.
// Same Math.random call-order dependency as the mixed-species group test
// above: (1) mini-dungeon check (miniDungeonChance undefined, always misses,
// still consumes a call), (2) cache check (cacheChance: 0, same deal), (3)
// the encounterChance roll itself, then - only if that roll hits - (4) the
// elite roll and (5) the monsterTable pick. monsterKillCounts stays at 0 so
// rollEncounterGroup's own kills-threshold check short-circuits before ever
// calling rng() (js/systems/groupEncounters.js), consuming no further calls.
test('mapScreen DOM - worn-path discount reduces the wild-encounter roll', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  // 7 columns wide, moving right from x=1 to x=2 - both interior, non-edge
  // tiles (same shape as the encounter-cooldown fixture above), so the step
  // actually resolves. A narrower map's rightmost column is a sealed world
  // edge (isSealedWorldEdge) and silently blocks the move entirely - caught
  // live building this test, when a 3-wide version left position unchanged.
  function wornPlains() {
    return {
      id: 'plains',
      legend: { '.': 'grass' },
      rows: ['.......', '.......', '.......'],
      neighbors: {},
      monsterTable: ['boar'],
      encounterChance: 0.5,
      cacheChance: 0,
    };
  }

  await t.test('a fully-worn tile can turn a would-be encounter into a miss', async () => {
    const originalRandom = Math.random;
    // 0.3 sits between the discounted threshold (0.5 * 0.5 = 0.25, a miss)
    // and the undiscounted one (0.5, a hit) - the value that actually
    // distinguishes the two behaviors under test.
    const sequence = [0.5, 0.5, 0.3];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    try {
      const plains = wornPlains();
      const maps = { plains };
      const worldGrid = buildWorldGrid(maps);
      const state = baseState({
        map: 'plains',
        position: { x: 1, y: 1 },
        // Pre-worn to TRAIL_WEAR_CAP - the tile being stepped onto (2, 1) has
        // already been walked 10 times before this step, not by this step.
        visited: { plains: { '2,1': { count: 10, dirs: [] } } },
      });
      let encountered = false;
      const { mount } = await import('../js/screens/mapScreen.js');
      const root = createRoot();
      mount(root, {
        state, mapConfig: plains, maps, worldGrid,
        callbacks: {
          onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
          onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
          onGateReward: () => {}, onEncounter: () => { encountered = true; }, onWornPathHint: () => {},
        },
      });
      keydown('ArrowRight');
      assert.equal(encountered, false, 'expected the worn-path discount to turn this roll into a miss');
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('a partially-worn tile applies a proportional discount, not just the full-wear case', async () => {
    const originalRandom = Math.random;
    // count: 5 is half of TRAIL_WEAR_CAP (10), so the multiplier is
    // 1 - 0.5*0.5 = 0.75 - effective chance 0.5*0.75 = 0.375. 0.4 sits
    // between that and the undiscounted 0.5, so this only misses if the
    // real call site actually applies a *proportional* (not all-or-nothing)
    // discount for a mid-range visit count.
    const sequence = [0.5, 0.5, 0.4];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    try {
      const plains = wornPlains();
      const maps = { plains };
      const worldGrid = buildWorldGrid(maps);
      const state = baseState({
        map: 'plains',
        position: { x: 1, y: 1 },
        visited: { plains: { '2,1': { count: 5, dirs: [] } } },
      });
      let encountered = false;
      const { mount } = await import('../js/screens/mapScreen.js');
      const root = createRoot();
      mount(root, {
        state, mapConfig: plains, maps, worldGrid,
        callbacks: {
          onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
          onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
          onGateReward: () => {}, onEncounter: () => { encountered = true; }, onWornPathHint: () => {},
        },
      });
      keydown('ArrowRight');
      assert.equal(encountered, false, 'expected the half-worn tile\'s proportional discount to turn this roll into a miss');
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('disabling the setting restores the undiscounted chance on the same tile/roll', async () => {
    const originalRandom = Math.random;
    const sequence = [0.5, 0.5, 0.3, 0.99, 0.01];
    let i = 0;
    Math.random = () => sequence[Math.min(i++, sequence.length - 1)];
    try {
      const plains = wornPlains();
      const maps = { plains };
      const worldGrid = buildWorldGrid(maps);
      const state = baseState({
        map: 'plains',
        position: { x: 1, y: 1 },
        visited: { plains: { '2,1': { count: 10, dirs: [] } } },
      });
      state.settings = { ...state.settings, wornPathDiscountEnabled: false };
      let encountered = false;
      const { mount } = await import('../js/screens/mapScreen.js');
      const root = createRoot();
      mount(root, {
        state, mapConfig: plains, maps, worldGrid,
        callbacks: {
          onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
          onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
          onGateReward: () => {}, onEncounter: () => { encountered = true; }, onWornPathHint: () => {},
        },
      });
      keydown('ArrowRight');
      assert.equal(encountered, true, 'expected the same roll to hit once the discount setting is off');
    } finally {
      Math.random = originalRandom;
    }
  });

  await t.test('fires the one-time hint banner callback the first time the discount actually applies, gated on the setting', async () => {
    const plains = wornPlains();
    const maps = { plains };
    const worldGrid = buildWorldGrid(maps);
    const state = baseState({
      map: 'plains',
      position: { x: 1, y: 1 },
      visited: { plains: { '2,1': { count: 10, dirs: [] } } },
    });
    let hintCount = 0;
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      state, mapConfig: plains, maps, worldGrid,
      callbacks: {
        onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
        onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
        onGateReward: () => {}, onEncounter: () => {}, onWornPathHint: () => { hintCount += 1; },
      },
    });
    keydown('ArrowRight');
    assert.equal(hintCount, 1, 'expected the hint to fire once, stepping onto an already-worn tile');
    assert.equal(state.flags.wornPathHintShown, true);
  });

  await t.test('never fires the hint while debugNoEncounters is set (encounters are off entirely in that mode)', async () => {
    const plains = wornPlains();
    const maps = { plains };
    const worldGrid = buildWorldGrid(maps);
    const state = baseState({
      map: 'plains',
      position: { x: 1, y: 1 },
      visited: { plains: { '2,1': { count: 10, dirs: [] } } },
    });
    let hintCount = 0;
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      debugNoEncounters: true,
      state, mapConfig: plains, maps, worldGrid,
      callbacks: {
        onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
        onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
        onGateReward: () => {}, onEncounter: () => {}, onWornPathHint: () => { hintCount += 1; },
      },
    });
    keydown('ArrowRight');
    assert.equal(hintCount, 0, 'expected no hint while debugNoEncounters is set - announcing a discount when encounters are off entirely would be misleading');
  });

  await t.test('never fires the hint when the discount setting is off', async () => {
    const plains = wornPlains();
    const maps = { plains };
    const worldGrid = buildWorldGrid(maps);
    const state = baseState({
      map: 'plains',
      position: { x: 1, y: 1 },
      visited: { plains: { '2,1': { count: 10, dirs: [] } } },
    });
    state.settings = { ...state.settings, wornPathDiscountEnabled: false };
    let hintCount = 0;
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    mount(root, {
      state, mapConfig: plains, maps, worldGrid,
      callbacks: {
        onFirstVisit: () => {}, onMove: () => {}, onToolGateCleared: () => {}, onLockedGate: () => {},
        onToolGateNearby: () => {}, onAction: () => {}, onEnterMiniDungeon: () => {}, onCacheFound: () => {},
        onGateReward: () => {}, onEncounter: () => {}, onWornPathHint: () => { hintCount += 1; },
      },
    });
    keydown('ArrowRight');
    assert.equal(hintCount, 0, 'expected no hint while the discount setting is off');
  });
});

test('mapScreen DOM - town exits', async (t) => {
  t.beforeEach(() => setupDom());
  t.afterEach(async () => {
    const { unmount } = await import('../js/screens/mapScreen.js');
    unmount();
    teardownDom();
  });

  async function mountTownWithActionCapture(position) {
    const { mount } = await import('../js/screens/mapScreen.js');
    const root = createRoot();
    const maps = { town: townMap };
    let capturedAction = null;
    mount(root, {
      state: baseState({ position }),
      mapConfig: townMap,
      maps,
      worldGrid: buildWorldGrid(maps),
      callbacks: { onFirstVisit: () => {}, onMove: () => {}, onAction: (action) => { capturedAction = action; } },
    });
    return { root, getAction: () => capturedAction };
  }

  await t.test('walking onto the north gap fires exitTownNorth', async () => {
    const { getAction } = await mountTownWithActionCapture({ x: 10, y: 1 });
    keydown('ArrowUp');
    assert.equal(getAction(), 'exitTownNorth');
  });

  await t.test('walking onto the south gap fires exitTownSouth', async () => {
    const { getAction } = await mountTownWithActionCapture({ x: 10, y: 12 });
    keydown('ArrowDown');
    assert.equal(getAction(), 'exitTownSouth');
  });

  await t.test('walking onto the west gap fires exitTownWest', async () => {
    const { getAction } = await mountTownWithActionCapture({ x: 1, y: 7 });
    keydown('ArrowLeft');
    assert.equal(getAction(), 'exitTownWest');
  });

  await t.test('walking onto the east gap fires exitTownEast', async () => {
    const { getAction } = await mountTownWithActionCapture({ x: 18, y: 7 });
    keydown('ArrowRight');
    assert.equal(getAction(), 'exitTownEast');
  });
});

// Not renderer-dependent at all - this reads the axe dungeon's own static
// map data directly, with nothing mounted. Kept because nothing else in the
// suite checks this ("In the center of their map instead of the corner" -
// all four tool dungeons share this exact layout, see axeDungeon.js's own
// comment) - the rest of the old "tool dungeon guardian rendering" block
// this used to live in (grass background class, oversized fontSize,
// z-index) was pure DOM-renderer rendering assertions, now covered instead
// by tests/mapDrawList.test.js.
test('mapScreen DOM - tool dungeon guardian position', async () => {
  const { axeDungeonMap } = await import('../js/maps/toolDungeons/axeDungeon.js');
  const { x, y } = findGuardianPosition(axeDungeonMap);
  assert.deepEqual({ x, y }, { x: 10, y: 6 });
});

function findGuardianPosition(map) {
  for (let y = 0; y < map.rows.length; y++) {
    for (let x = 0; x < map.rows[y].length; x++) {
      if (map.legend[map.rows[y][x]] === 'guardian') return { x, y };
    }
  }
  throw new Error(`${map.id} has no guardian tile`);
}
