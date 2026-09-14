# Superboss Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the balance simulator's two blind spots that hid superBossOne's real difficulty curve, add NG+-cycle-gated superboss encounters, and ship four new superbosses (one per NG+ cycle 1-4) using the now-trustworthy simulator.

**Architecture:** Three sequential phases, each independently shippable and testable. Phase 0 touches only `scripts/simulate-balance.js` (a manual balance tool, not part of `npm test`). Phase 1 adds one new pure-logic module (`js/systems/superBossGates.js`, mirroring the existing `js/systems/toolGates.js` shape) plus two call sites in `js/main.js`. Phase 2 adds data-only entries to `js/data/monsters.js`, `js/data/superBosses.js`, and `js/data/items.js` — no new mechanics, reusing everything `superBossOne` already exercises.

**Tech Stack:** Vanilla JS (ES modules), Node's built-in `node:test`/`node:assert`, no framework.

**Spec:** `docs/superpowers/specs/2026-09-13-superboss-expansion-design.md`

## Global Constraints

- Every commit that touches non-doc files needs a `CHANGELOG.md` entry under `## [Unreleased]` (CI enforces this — see `CLAUDE.md`).
- At the end of each phase (Tasks 3, 5, and 10 below), bump `Unreleased` into a new dated version section, add a matching `js/data/playerChangelog.js` entry, run `npm run test`, then push — treat each phase as its own release per this repo's "every push is a release" rule. Phases 0 and 1 are PATCH bumps (tooling/plumbing, no visible content yet); Phase 2 is a MINOR bump (new content, per `CHANGELOG.md`'s own versioning rules).
- All numeric stat targets in Phase 2 are explicitly first-pass, not final — flagged inline, matching this repo's standing convention (see `2026-08-30-ng-plus-gear-progression-design.md`'s "Open / explicitly tunable numbers").
- `js/main.js` has no exports of its own (it runs full app bootstrap at module scope) — it is not directly unit-testable. Any logic that needs a unit test must live in an importable module `main.js` calls into, never inline in `main.js` itself. This is why Phase 1's actual gating predicate lives in `js/systems/superBossGates.js`, not in `main.js`'s `handleTileAction`.

---

## Phase 0: Simulator fixes

### Task 1: Fix `maxedUpgrades()` to use the real per-cycle upgrade cap

**Files:**
- Modify: `scripts/simulate-balance.js:49` (import), `scripts/simulate-balance.js:154-163` (`maxedUpgrades`), `scripts/simulate-balance.js:266-301` (the two NG+2 build constructors that call it)

**Interfaces:**
- Consumes: `getMaxUpgradeLevel(ngPlusCycle)` from `js/systems/inventory.js` (already exists, exported).
- Produces: `maxedUpgrades(equipment, equipmentTiers, cycle = 0)` — the `cycle` parameter is new; existing call sites that omit it keep today's behavior (cycle 0 → `getMaxUpgradeLevel(0)` which equals the old flat `MAX_UPGRADE_LEVEL` of 3, so this is backward-compatible).

This is the single root cause of this whole investigation: the "maxed Mythic L12 (NG+2, ...)" builds are meant to represent a player who has actually reached NG+2's real gear ceiling, but `maxedUpgrades()` always applied the flat `MAX_UPGRADE_LEVEL` (3) regardless of what cycle the build claims to represent, silently under-gearing every NG+ build the file has ever produced.

- [ ] **Step 1: Change the import to pull in `getMaxUpgradeLevel`**

In `scripts/simulate-balance.js`, change line 49 from:
```js
import { getEquipmentBonuses, upgradeKey, MAX_UPGRADE_LEVEL } from '../js/systems/inventory.js';
```
to:
```js
import { getEquipmentBonuses, upgradeKey, MAX_UPGRADE_LEVEL, getMaxUpgradeLevel } from '../js/systems/inventory.js';
```

- [ ] **Step 2: Update `maxedUpgrades()` to take a cycle parameter**

Change:
```js
// Every slot at Mythic tier, upgrade level 3 (the actual ceiling this
// feature is meant to raise) - used by the maxed-Mythic NG+2 build below.
function maxedUpgrades(equipment, equipmentTiers) {
  const upgrades = {};
  for (const [slot, itemId] of Object.entries(equipment)) {
    if (!itemId) continue;
    upgrades[upgradeKey(itemId, equipmentTiers[slot])] = MAX_UPGRADE_LEVEL;
  }
  return upgrades;
}
```
to:
```js
// Every slot upgraded to the REAL per-cycle ceiling (getMaxUpgradeLevel),
// not the flat MAX_UPGRADE_LEVEL this used to hardcode regardless of which
// cycle the build claims to represent - that mismatch is what hid
// superBossOne's real NG+2 difficulty curve from every simulator run before
// 2026-09-13 (see docs/superpowers/specs/2026-09-13-superboss-expansion-design.md's
// Problem section). Defaults to cycle 0, where getMaxUpgradeLevel(0) equals
// the old flat MAX_UPGRADE_LEVEL exactly, so existing callers that omit the
// third argument are unaffected.
function maxedUpgrades(equipment, equipmentTiers, cycle = 0) {
  const upgrades = {};
  const level = getMaxUpgradeLevel(cycle);
  for (const [slot, itemId] of Object.entries(equipment)) {
    if (!itemId) continue;
    upgrades[upgradeKey(itemId, equipmentTiers[slot])] = level;
  }
  return upgrades;
}
```

- [ ] **Step 3: Pass the real cycle into both NG+2 build constructors**

In the `'maxed Mythic L12 (NG+2, no rings)'` build (around line 266-277), change:
```js
    return makeBuild({
      name: 'maxed Mythic L12 (NG+2, no rings)',
      level: 12,
      equipment,
      equipmentTiers,
      upgrades: maxedUpgrades(equipment, equipmentTiers),
      potions: 6,
    });
```
to:
```js
    return makeBuild({
      name: 'maxed Mythic L12 (NG+2, no rings)',
      level: 12,
      equipment,
      equipmentTiers,
      upgrades: maxedUpgrades(equipment, equipmentTiers, 2),
      potions: 6,
    });
```

In the `'maxed Mythic L12 (NG+2, +rings)'` build (around line 284-301), make the identical change: `maxedUpgrades(equipment, equipmentTiers)` → `maxedUpgrades(equipment, equipmentTiers, 2)`.

- [ ] **Step 4: Run the simulator and confirm the NG+2 builds now show higher upgrade levels**

Run: `node scripts/simulate-balance.js --trials 500`

Expected: in the "Player builds under test" listing near the top of the output, both `maxed Mythic L12 (NG+2, ...)` builds now show noticeably higher `atk`/`def`/`hp` numbers than before this change (upgrade level 7 instead of 3 on every slot — each level is worth +25% of an item's base stat, compounding with the Mythic tier multiplier). Confirm no other build's stats changed (everything else still calls `maxedUpgrades` with cycle 0 or doesn't call it at all).

- [ ] **Step 5: Commit**

```bash
git add scripts/simulate-balance.js CHANGELOG.md
git commit -m "fix: simulate-balance.js now tests the real per-cycle upgrade cap, not a flat +3"
```
(Add a `### Fixed` entry under `## [Unreleased]` in `CHANGELOG.md` before committing — see Global Constraints.)

---

### Task 2: Add a separate, higher parry rate for telegraphed special attacks

**Files:**
- Modify: `scripts/simulate-balance.js:78-107` (`parseArgs`), `scripts/simulate-balance.js:395-496` (`simulateBattle`), `scripts/simulate-balance.js` main/report section where `runMatchup` is called

**Interfaces:**
- Consumes: `PARRY_LAND_RATE_DEFAULT` (existing constant, unchanged).
- Produces: new constant `SPECIAL_PARRY_LAND_RATE_DEFAULT = 0.55`; `simulateBattle(build, monsterStats, parryLandRate, specialParryLandRate)` gains a 4th parameter; `parseArgs()`'s returned `opts` object gains `opts.specialParryRate`.

Today, `simulateBattle()` rolls one flat `parryLandRate` for every monster turn before checking whether that turn is a telegraphed special attack (`rollSpecialAttack`) or a routine hit — so a special gets exactly the same 30%-by-default parry odds as a plain swing. In the real game, a special attack's windup carries a distinct flavor line/icon specifically so the player can react to it (per the original superboss-pass spec) — a real player pays more attention to that cue than to a routine swing. This session's own scratch testing confirmed the effect size: disabling `superBossOne`'s special attacks entirely raised its NG+1 win rate from 40% to 87%, with no other change — meaning the flat rate is a large, previously-uncounted source of simulator pessimism.

- [ ] **Step 1: Add the new constant and CLI flag**

Directly below the existing `PARRY_LAND_RATE_DEFAULT` constant and its comment block, add:
```js
// Higher than PARRY_LAND_RATE_DEFAULT: a telegraphed special attack gets its
// own distinct flavor line/icon (2026-09-05 spec) specifically so a real
// player can react to it, unlike a routine hit. Modeling both at the same
// flat rate made every superboss look far harder in this file than in real
// play - confirmed 2026-09-13 by disabling superBossOne's specials outright,
// which raised its NG+1 win rate from 40% to 87% with nothing else changed.
// 0.55 is a starting hypothesis, not a measured number - override via
// --special-parry-rate to explore other assumptions, same as --parry-rate.
const SPECIAL_PARRY_LAND_RATE_DEFAULT = 0.55;
```

In `parseArgs()`, change:
```js
function parseArgs(argv) {
  const opts = { trials: 2000, parryRate: PARRY_LAND_RATE_DEFAULT, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trials') {
      opts.trials = Number(argv[++i]);
    } else if (argv[i] === '--parry-rate') {
      opts.parryRate = Number(argv[++i]);
      if (!Number.isFinite(opts.parryRate)) {
        throw new Error(`--parry-rate expects a number, got ${JSON.stringify(argv[i])}`);
      }
    } else if (argv[i] === '--set') {
```
to:
```js
function parseArgs(argv) {
  const opts = { trials: 2000, parryRate: PARRY_LAND_RATE_DEFAULT, specialParryRate: SPECIAL_PARRY_LAND_RATE_DEFAULT, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trials') {
      opts.trials = Number(argv[++i]);
    } else if (argv[i] === '--parry-rate') {
      opts.parryRate = Number(argv[++i]);
      if (!Number.isFinite(opts.parryRate)) {
        throw new Error(`--parry-rate expects a number, got ${JSON.stringify(argv[i])}`);
      }
    } else if (argv[i] === '--special-parry-rate') {
      opts.specialParryRate = Number(argv[++i]);
      if (!Number.isFinite(opts.specialParryRate)) {
        throw new Error(`--special-parry-rate expects a number, got ${JSON.stringify(argv[i])}`);
      }
    } else if (argv[i] === '--set') {
```

- [ ] **Step 2: Thread the new rate through `simulateBattle()`**

Change the function signature:
```js
function simulateBattle(build, monsterStats, parryLandRate = PARRY_LAND_RATE_DEFAULT) {
```
to:
```js
function simulateBattle(build, monsterStats, parryLandRate = PARRY_LAND_RATE_DEFAULT, specialParryLandRate = SPECIAL_PARRY_LAND_RATE_DEFAULT) {
```

Inside the `isReady(monster.atb)` block, the special is already rolled before the parry check:
```js
      const special = rollSpecialAttack(monster.specialAttacks);
      let result;
      if (parryCooldownMs <= 0 && Math.random() < parryLandRate) {
```
Change the condition to use `specialParryLandRate` when `special` is truthy:
```js
      const special = rollSpecialAttack(monster.specialAttacks);
      const effectiveParryRate = special ? specialParryLandRate : parryLandRate;
      let result;
      if (parryCooldownMs <= 0 && Math.random() < effectiveParryRate) {
```

- [ ] **Step 3: Pass the option through `runMatchup()` and its caller**

Change `runMatchup`'s signature and internal call, from:
```js
function runMatchup(build, monsterStats, trials, parryLandRate) {
  let wins = 0;
  let stalemates = 0;
  let hpLeftOnWin = 0;
  let potionsUsed = 0;
  let specialAttacksLanded = 0;
  let specialAttacksParried = 0;

  for (let i = 0; i < trials; i++) {
    const result = simulateBattle(build, monsterStats, parryLandRate);
```
to:
```js
function runMatchup(build, monsterStats, trials, parryLandRate, specialParryLandRate) {
  let wins = 0;
  let stalemates = 0;
  let hpLeftOnWin = 0;
  let potionsUsed = 0;
  let specialAttacksLanded = 0;
  let specialAttacksParried = 0;

  for (let i = 0; i < trials; i++) {
    const result = simulateBattle(build, monsterStats, parryLandRate, specialParryLandRate);
```

In `main()`, change the `parseArgs` destructuring from:
```js
  const { trials, overrides, parryRate } = parseArgs(process.argv.slice(2));
```
to:
```js
  const { trials, overrides, parryRate, specialParryRate } = parseArgs(process.argv.slice(2));
```

And change the single call site inside the report-printing loop, from:
```js
      const r = runMatchup(build, monsters[id], trials, parryRate);
```
to:
```js
      const r = runMatchup(build, monsters[id], trials, parryRate, specialParryRate);
```

- [ ] **Step 4: Run the simulator with the new flag and confirm it changes results**

Run: `node scripts/simulate-balance.js --trials 500 --special-parry-rate 1.0`

Expected: every superboss matchup's win rate goes up compared to a default run (`node scripts/simulate-balance.js --trials 500`), since a `--special-parry-rate` of 1.0 means every telegraphed special is always parried. Then run with `--special-parry-rate 0` and confirm results match (or are close to, given RNG noise) the pre-Task-1/2 baseline behavior for special-heavy matchups, since a 0% special-parry rate means every special always lands, closer to today's un-fixed behavior for the special-attack portion specifically.

- [ ] **Step 5: Commit**

```bash
git add scripts/simulate-balance.js CHANGELOG.md
git commit -m "feat: model a separate, higher parry rate for telegraphed special attacks in the balance simulator"
```

---

### Task 3: Add a `--cycle-sweep` mode and ship Phase 0

**Files:**
- Modify: `scripts/simulate-balance.js` (`parseArgs`, a new `runCycleSweep` function, `main()`'s dispatch)
- Modify: `CHANGELOG.md`, `js/data/playerChangelog.js`

**Interfaces:**
- Consumes: `getMaxUpgradeLevel`, `MONSTERS`, `getNgPlusCombatOverrides`, `runMatchup` (all already available in this file after Tasks 1-2).
- Produces: `--cycle-sweep <bossId>` CLI mode; no new exports (this file has no exports — it's a script, run via `node`).

This is the tool Phase 2 will actually be validated with: instead of one fixed level-12 "maxed" build, sweep across levels and upgrade tiers spanning "just arrived at a cycle" through "farmed that cycle's ceiling," for a given superboss, at a given cycle.

- [ ] **Step 1: Add the CLI flag**

In `parseArgs()`, add another branch (after the `--special-parry-rate` branch added in Task 2):
```js
    } else if (argv[i] === '--cycle-sweep') {
      opts.cycleSweepBossId = argv[++i];
```
Also default it in the initial `opts` object: `opts = { trials: 2000, parryRate: PARRY_LAND_RATE_DEFAULT, specialParryRate: SPECIAL_PARRY_LAND_RATE_DEFAULT, cycleSweepBossId: null, overrides: {} }`.

- [ ] **Step 2: Write `runCycleSweep()`**

Add this function near `runMatchup` (it reuses `runMatchup` and `makeBuild`, both already defined above it in the file):
```js
// For a given superboss id, builds a small level/upgrade-level matrix per
// NG+ cycle from 0 to 4: "cycle-start gear" (full iron/Superior-tier shop
// gear, upgrade level 0, a level a few above the previous cycle's expected
// finish) through "cycle-ceiling gear" (Mythic everywhere, upgraded to
// getMaxUpgradeLevel(cycle)). First-pass level numbers below extrapolate
// from Timothy's own save (entered NG+2 at level 17, beat superBossOne's
// NG+2 fight comfortably at level 19-20) - refine once more real telemetry
// exists for the new bosses this tool is meant to validate.
const CYCLE_SWEEP_LEVELS = { start: [8, 12, 15, 17, 19], ceiling: [10, 15, 18, 20, 22] };

function runCycleSweep(bossId, trials, parryRate, specialParryRate) {
  const baseMonster = MONSTERS[bossId];
  if (!baseMonster) throw new Error(`--cycle-sweep: unknown monster id '${bossId}'`);

  const equipment = {
    weapon: 'ironSword', head: 'ironHelm', body: 'ironArmor', legs: 'ironGreaves',
    accessory: 'powerRing', ring1: 'emberRing', ring2: 'windfuryRing',
  };

  console.log(`\n=== Cycle sweep: ${baseMonster.name} ===`);
  for (let cycle = 0; cycle <= 4; cycle++) {
    const monsterStats = { ...baseMonster, ...getNgPlusCombatOverrides(baseMonster, cycle) };
    console.log(`\n-- NG+${cycle} (hp ${monsterStats.hp}, atk ${monsterStats.attack}, def ${monsterStats.defense}) --`);

    const startBuild = makeBuild({
      name: `cycle-start (L${CYCLE_SWEEP_LEVELS.start[cycle]})`,
      level: CYCLE_SWEEP_LEVELS.start[cycle],
      equipment: { weapon: 'ironSword', head: 'ironHelm', body: 'ironArmor', legs: 'ironGreaves', accessory: 'powerRing' },
      equipmentTiers: { weapon: 'superior', head: 'superior', body: 'superior', legs: 'superior', accessory: 'superior' },
      upgrades: {},
      potions: 6,
    });
    const ceilingTiers = { weapon: 'mythic', head: 'mythic', body: 'mythic', legs: 'mythic', accessory: 'mythic', ring1: 'mythic', ring2: 'mythic' };
    const ceilingBuild = makeBuild({
      name: `cycle-ceiling (L${CYCLE_SWEEP_LEVELS.ceiling[cycle]})`,
      level: CYCLE_SWEEP_LEVELS.ceiling[cycle],
      equipment,
      equipmentTiers: ceilingTiers,
      upgrades: maxedUpgrades(equipment, ceilingTiers, cycle),
      potions: 6,
    });

    for (const build of [startBuild, ceilingBuild]) {
      const r = runMatchup(build, monsterStats, trials, parryRate, specialParryRate);
      console.log(`  ${build.name.padEnd(28)} win ${(r.winRate * 100).toFixed(0)}%  hp-left ${(r.avgHpLeftOnWin * 100).toFixed(0)}%  potions ${r.avgPotions.toFixed(1)}`);
    }
  }
}
```

- [ ] **Step 3: Dispatch to it from `main()`**

`main()` (defined near the bottom of the file, called unconditionally via a bare `main();` on the last line — there is no `require.main`-style guard in this file) starts by destructuring `parseArgs()`'s result and then unconditionally builds the full `monsters`/`BUILDS` report. Change the start of `main()` from:
```js
function main() {
  const { trials, overrides, parryRate, specialParryRate } = parseArgs(process.argv.slice(2));

  const monsters = {};
```
to:
```js
function main() {
  const { trials, overrides, parryRate, specialParryRate, cycleSweepBossId } = parseArgs(process.argv.slice(2));

  if (cycleSweepBossId) {
    runCycleSweep(cycleSweepBossId, trials, parryRate, specialParryRate);
    return;
  }

  const monsters = {};
```
(`overrides` is unused in the `--cycle-sweep` path, which is fine — it's still destructured because the existing full-report path below still needs it.)

- [ ] **Step 4: Run it against `superBossOne` and sanity-check the shape**

Run: `node scripts/simulate-balance.js --cycle-sweep superBossOne --trials 500`

Expected: five `-- NG+0` through `-- NG+4` sections, each printing a `cycle-start` and `cycle-ceiling` row with win/hp-left/potions numbers. Sanity check: NG+2's `cycle-ceiling` row should show a high win rate and high hp-left (consistent with Timothy's real 100%-HP win at NG+2 ceiling gear) — if it still shows 0%, Tasks 1-2 didn't fully close the gap and that's worth flagging before moving on, not silently ignoring.

- [ ] **Step 5: Bump the version and push (end of Phase 0)**

Bump `CHANGELOG.md`'s `Unreleased` section into a new dated PATCH version (this is tooling-only, no player-visible change). Add a matching `js/data/playerChangelog.js` entry noting it's internal-only (mirror the tone of the existing 0.34.1-0.34.4 entries in that file). Run `npm run test` and confirm it's fully green. Commit, push the branch, open a PR titled around "fix balance simulator's NG+ upgrade-cap and special-attack modeling," and stop — do not merge (per this repo's convention this session, merges are the repo owner's call).

---

## Phase 1: NG+-cycle gating

### Task 4: Add the `debutNgPlusCycle` gating predicate, with tests

**Files:**
- Create: `js/systems/superBossGates.js`
- Test: `tests/superBossGates.test.js`
- Modify: `tests/superBosses.test.js` (extend the existing shape test)

**Interfaces:**
- Produces: `isSuperBossDebuted(entry, ngPlusCycle)` → boolean; `getSuperBossNotYetMessage()` → string. Both pure functions, no side effects — this is the testable seam Task 5 (in `main.js`, which has no exports) will call into, mirroring how `js/systems/toolGates.js`'s `hasRequiredTool`/`getLockedGateMessage` are the testable seam `mapScreen.js` calls into.

- [ ] **Step 1: Write the failing tests**

Create `tests/superBossGates.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSuperBossDebuted, getSuperBossNotYetMessage } from '../js/systems/superBossGates.js';

test('isSuperBossDebuted is true for an entry with no debutNgPlusCycle field, at any cycle', () => {
  const entry = { id: 'superBossOne' };
  assert.equal(isSuperBossDebuted(entry, 0), true);
  assert.equal(isSuperBossDebuted(entry, 3), true);
});

test('isSuperBossDebuted is true for an entry with debutNgPlusCycle: 0, at any cycle', () => {
  const entry = { id: 'superBossOne', debutNgPlusCycle: 0 };
  assert.equal(isSuperBossDebuted(entry, 0), true);
  assert.equal(isSuperBossDebuted(entry, 1), true);
});

test('isSuperBossDebuted is false below the required cycle, true at and above it', () => {
  const entry = { id: 'superBossTwo', debutNgPlusCycle: 2 };
  assert.equal(isSuperBossDebuted(entry, 0), false);
  assert.equal(isSuperBossDebuted(entry, 1), false);
  assert.equal(isSuperBossDebuted(entry, 2), true);
  assert.equal(isSuperBossDebuted(entry, 3), true);
});

test('getSuperBossNotYetMessage returns a non-empty string', () => {
  const message = getSuperBossNotYetMessage();
  assert.equal(typeof message, 'string');
  assert.ok(message.length > 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/superBossGates.test.js`
Expected: FAIL — `Cannot find module '../js/systems/superBossGates.js'`.

- [ ] **Step 3: Write `js/systems/superBossGates.js`**

```js
// Gates a superboss encounter on how far into New Game+ the player has
// gotten, parallel in spirit to js/systems/toolGates.js's hasRequiredTool -
// but keyed on state.ngPlusCycle instead of inventory, since a superboss
// encounter was never a required crossing to block (it's always optional,
// off the beaten path), just something that shouldn't be reachable yet.
// See docs/superpowers/specs/2026-09-13-superboss-expansion-design.md.
export function isSuperBossDebuted(entry, ngPlusCycle) {
  return ngPlusCycle >= (entry.debutNgPlusCycle || 0);
}

// One generic message, unlike toolGates.js's per-tool messages - there's no
// per-superboss variation needed yet (no player-facing name/flavor to plug
// in until Timothy authors one), so this stays a plain function for now
// rather than a lookup table with a single entry.
export function getSuperBossNotYetMessage() {
  return "You sense something powerful here, but it hasn't stirred yet. Perhaps it's waiting for you to grow stronger.";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/superBossGates.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Extend `tests/superBosses.test.js`'s shape test to cover the new optional field**

In `tests/superBosses.test.js`, find:
```js
test('every SUPER_BOSSES entry has the required shape', () => {
  for (const [id, entry] of Object.entries(SUPER_BOSSES)) {
    assert.equal(entry.id, id, `${id}'s own id field must match its registry key`);
    assert.equal(typeof entry.monsterId, 'string');
    assert.equal(typeof entry.hasDungeon, 'boolean');
    if (entry.hasDungeon) {
      assert.equal(typeof entry.dungeonMapId, 'string', `${id} has hasDungeon: true but no dungeonMapId`);
    } else {
      assert.equal(entry.dungeonMapId, null, `${id} has hasDungeon: false but a non-null dungeonMapId`);
    }
  }
});
```
Add a new assertion inside the same loop, right after the `dungeonMapId` check:
```js
    if ('debutNgPlusCycle' in entry) {
      assert.equal(typeof entry.debutNgPlusCycle, 'number', `${id}'s debutNgPlusCycle must be a number if present`);
      assert.ok(entry.debutNgPlusCycle >= 0, `${id}'s debutNgPlusCycle must be non-negative`);
      assert.ok(Number.isInteger(entry.debutNgPlusCycle), `${id}'s debutNgPlusCycle must be an integer`);
    }
```

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: PASS (all existing tests unaffected — `superBossOne` has no `debutNgPlusCycle` field, so the new `if ('debutNgPlusCycle' in entry)` branch is simply skipped for it).

- [ ] **Step 7: Commit**

```bash
git add js/systems/superBossGates.js tests/superBossGates.test.js tests/superBosses.test.js CHANGELOG.md
git commit -m "feat: add debutNgPlusCycle gating predicate for superboss encounters"
```

---

### Task 5: Wire the gate into `main.js`'s superboss action handlers, and ship Phase 1

**Files:**
- Modify: `js/main.js` (imports, `handleTileAction`'s `superBossBattle`/`enterSuperBossDungeon` branches)
- Modify: `CHANGELOG.md`, `js/data/playerChangelog.js`

**Interfaces:**
- Consumes: `isSuperBossDebuted`, `getSuperBossNotYetMessage` from `js/systems/superBossGates.js` (Task 4); `findSuperBossAt` (existing, `js/main.js:142`); `showFlavorBanner` (existing import, `js/main.js:57`); `state.ngPlusCycle` (existing state field).

This is the actual behavior change — it can't be unit-tested directly since `main.js` has no exports (Global Constraints), so verification here is a manual run-through, same as this codebase's own established pattern for `main.js`-level wiring changes.

- [ ] **Step 1: Import the new module**

In `js/main.js`, near the existing `import { SUPER_BOSSES } from './data/superBosses.js';` line, add:
```js
import { isSuperBossDebuted, getSuperBossNotYetMessage } from './systems/superBossGates.js';
```

- [ ] **Step 2: Gate `superBossBattle`**

Change:
```js
  if (action === 'superBossBattle') {
    const superBoss = findSuperBossAt(state.map, state.position.x, state.position.y);
    if (superBoss) handleEncounter([superBoss.monsterId]);
    return;
  }
```
to:
```js
  if (action === 'superBossBattle') {
    const superBoss = findSuperBossAt(state.map, state.position.x, state.position.y);
    if (!superBoss) return;
    if (!isSuperBossDebuted(superBoss, state.ngPlusCycle)) {
      showFlavorBanner(getSuperBossNotYetMessage());
      return;
    }
    handleEncounter([superBoss.monsterId]);
    return;
  }
```

- [ ] **Step 3: Gate `enterSuperBossDungeon`**

Change:
```js
  if (action === 'enterSuperBossDungeon') {
    const superBoss = findSuperBossAt(state.map, state.position.x, state.position.y);
    if (superBoss) return enterMap(superBoss.dungeonMapId);
    return;
  }
```
to:
```js
  if (action === 'enterSuperBossDungeon') {
    const superBoss = findSuperBossAt(state.map, state.position.x, state.position.y);
    if (!superBoss) return;
    if (!isSuperBossDebuted(superBoss, state.ngPlusCycle)) {
      showFlavorBanner(getSuperBossNotYetMessage());
      return;
    }
    return enterMap(superBoss.dungeonMapId);
  }
```

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS. This step touches only `main.js`, which has no existing test coverage of `handleTileAction` (confirmed in Task 4's design rationale) — this is a no-op check that nothing else broke, not a check of the new behavior itself, which Step 5 covers.

- [ ] **Step 5: Manually verify the gate with a temporary scratch edit**

The predicate itself (`isSuperBossDebuted`) is already exhaustively unit-tested in Task 4 for both the below-threshold and at/above-threshold cases. The only untested surface here is the *wiring* — does `main.js` actually call it and show the banner. That only needs the below-threshold (blocked) case exercised once, since the logic itself is already proven correct in isolation.

`js/systems/debugCharacters.js`'s `?debug=level10` preset (`DEBUG_CHARACTERS.level10`, loaded via `applyDebugCharacterFromUrl`) starts at `ngPlusCycle: 0` — below any nonzero `debutNgPlusCycle`, which is exactly the case to exercise. `SUPER_BOSSES.superBossOne` doesn't have a `debutNgPlusCycle` yet (Task 8 adds one to the *new* bosses only), so temporarily add one to it for this check:

1. In `js/data/superBosses.js`, temporarily change `superBossOne`'s entry to add `debutNgPlusCycle: 1,` (do not commit this — it's reverted in step 4 below).
2. Run `node tools/dev-server.mjs 8000`, open `http://localhost:8000?debug=level10` in a browser.
3. In Character Select, continue into the `[Debug] level10` save. Navigate to the `farSoutheast` wilderness screen and walk to position (15, 9) — `superBossOne`'s placed location (`js/data/superBosses.js`'s own entry).
4. Confirm stepping onto the tile shows a flavor banner reading "You sense something powerful here, but it hasn't stirred yet..." instead of starting a battle.
5. Revert the scratch `debutNgPlusCycle: 1,` edit to `superBossOne` before committing — confirm with `git diff js/data/superBosses.js` that it shows no changes.

- [ ] **Step 6: Bump the version and push (end of Phase 1)**

Bump `CHANGELOG.md`'s `Unreleased` section into a new dated PATCH version (this plumbing is inert until Phase 2 gives it a real `debutNgPlusCycle`-bearing entry to gate — no visible change yet, same reasoning as Phase 0). Add a matching internal-only `js/data/playerChangelog.js` entry. Run `npm run test`, commit, push, open a PR, and stop for review — do not merge.

---

## Phase 2: Four new superbosses

### Task 6: Author one new unique-effect item for the loot pool

**Files:**
- Modify: `js/data/items.js` (add one new item near the existing `parryMasterRing`/`unshakenCharm`/`stormringOfHaste` block)

**Interfaces:**
- Produces: `ITEMS.guardiansLastStand` — a new item id, consumed by Task 7's `superBossFive` `dropTable`.

The existing pool (`parryMasterRing`, `unshakenCharm`, `stormringOfHaste`) covers three of this pass's four new bosses (per the spec's loot section); this task authors the fourth, for the hardest (cycle-4) boss, combining two stats already in `STAT_KEYS` (`thornsPercent`, `debuffDurationPercent` — both already wired end-to-end via `getEquipmentBonuses`/`getItemEffectiveStats`, no new combat code needed).

- [ ] **Step 1: Add the item**

In `js/data/items.js`, near the existing `stormringOfHaste` entry, add:
```js
  // Placeholder name, like superBossOne's own MONSTERS entry - Timothy's to
  // rename freely before this ships for real. Guaranteed drop for the
  // cycle-4 superboss (superBossFive) - thorns punishes melee retaliation,
  // debuffDurationPercent shortens the highest-cycle boss's slow/stun/
  // cooldown-overload specials, both already-wired stat fields (STAT_KEYS in
  // js/systems/inventory.js), zero new combat code needed.
  guardiansLastStand: { id: 'guardiansLastStand', name: "Guardian's Last Stand [PLACEHOLDER NAME]", emoji: '🛡️', slot: 'accessory', price: 0,
    stats: { thornsPercent: 30, debuffDurationPercent: 25 } },
```

- [ ] **Step 2: Run the test suite**

Run: `npm run test`
Expected: PASS. No test references this item yet (Task 7 wires it into a `dropTable`, which is what existing generic `superBosses.test.js` checks will validate against `ITEMS`).

- [ ] **Step 3: Commit**

```bash
git add js/data/items.js CHANGELOG.md
git commit -m "feat: add Guardian's Last Stand unique item for the cycle-4 superboss's guaranteed drop"
```

---

### Task 7: Add the four new superboss monster entries

**Files:**
- Modify: `js/data/monsters.js` (add four entries after the existing `superBossOne` block)

**Interfaces:**
- Produces: `MONSTERS.superBossTwo`, `MONSTERS.superBossThree`, `MONSTERS.superBossFour`, `MONSTERS.superBossFive` — consumed by Task 8's `SUPER_BOSSES` entries and automatically covered by `tests/superBosses.test.js`'s existing generic checks (shape, `specialAttacks` shape, `dropTable` validity, `forceFullBattle`/`isBoss` invariants — all already iterate `Object.values(MONSTERS).filter((m) => m.isSuperBoss)` or `Object.values(SUPER_BOSSES)` generically, no test changes needed here).

Base stats below are picked so that, once multiplied by the existing `getNgPlusCombatOverrides(monster, cycle)` formula (`hp × 2^cycle`, `attack`/`defense` × `1.25^cycle`) at each boss's own debut cycle, the *effective* first-encounter stat block is shorter-fight (lower HP) and harder-hitting (higher attack relative to defense-scaling headroom) than `superBossOne`'s own cycle-scaled equivalent — directly answering Timothy's "too much health but didn't hit hard enough" diagnosis. All four are explicitly first-pass, to be validated and retuned via Task 3's `--cycle-sweep` mode before Timothy places them for real (same two-retune-pass process `superBossOne` itself already went through — see the comment above `MONSTERS.superBossOne`).

- [ ] **Step 1: Add the four entries**

In `js/data/monsters.js`, immediately after the closing `},` of the existing `superBossOne` entry (before the final `};` that closes the `MONSTERS` object), add:
```js
  // Debuts at NG+1 (see SUPER_BOSSES.superBossTwo's debutNgPlusCycle).
  // FIRST-PASS STATS, not final - validate/retune with:
  //   node scripts/simulate-balance.js --cycle-sweep superBossTwo
  // before Timothy places this for real. Base numbers below produce, once
  // getNgPlusCombatOverrides scales them at NG+1 (hp x2, atk/def x1.25):
  // effective hp 2200 / atk 75 / def 26 - meaningfully less HP and more
  // attack than superBossOne's own NG+1-scaled 6000/69/30, per this pass's
  // "shorter, harder-hitting" design goal.
  superBossTwo: {
    id: 'superBossTwo', name: 'Super Boss Two [PLACEHOLDER NAME]', emoji: '👹',
    hp: 1100, attack: 60, defense: 21, speed: 14,
    xp: 650, goldRange: [180, 260],
    dropTable: [{ itemId: 'parryMasterRing', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.25, durationMs: 1200 },
      { type: 'slow', chancePerTurn: 0.25, slowPercent: 25, durationMs: 4000 },
      { type: 'cooldownOverload', chancePerTurn: 0.2, gcdMs: 6000 },
    ],
    attackStyle: 'melee',
  },
  // Debuts at NG+2. FIRST-PASS STATS - validate with
  //   node scripts/simulate-balance.js --cycle-sweep superBossThree
  // Base numbers produce, at NG+2 (hp x4, atk/def x1.5625): effective hp
  // 3200 / atk 109 / def 30 - vs. superBossOne's own NG+2-scaled
  // 12000/86/38 (the exact fight Timothy beat at 100% HP doing "like 2
  // damage") - deliberately far less HP, more attack.
  superBossThree: {
    id: 'superBossThree', name: 'Super Boss Three [PLACEHOLDER NAME]', emoji: '🧟',
    hp: 800, attack: 70, defense: 19, speed: 15,
    xp: 850, goldRange: [220, 320],
    dropTable: [{ itemId: 'unshakenCharm', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.3, durationMs: 1300 },
      { type: 'slow', chancePerTurn: 0.25, slowPercent: 30, durationMs: 4000 },
      { type: 'cooldownOverload', chancePerTurn: 0.2, gcdMs: 6500 },
    ],
    attackStyle: 'ranged', projectileEmoji: '🦴',
  },
  // Debuts at NG+3. FIRST-PASS STATS - validate with
  //   node scripts/simulate-balance.js --cycle-sweep superBossFour
  // Base numbers produce, at NG+3 (hp x8, atk/def x1.953125): effective hp
  // 4504 / atk 150 / def 33.
  superBossFour: {
    id: 'superBossFour', name: 'Super Boss Four [PLACEHOLDER NAME]', emoji: '👺',
    hp: 563, attack: 77, defense: 17, speed: 15,
    xp: 1100, goldRange: [280, 400],
    dropTable: [{ itemId: 'stormringOfHaste', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.3, durationMs: 1400 },
      { type: 'slow', chancePerTurn: 0.3, slowPercent: 30, durationMs: 4500 },
      { type: 'cooldownOverload', chancePerTurn: 0.25, gcdMs: 6500 },
    ],
    attackStyle: 'melee',
  },
  // Debuts at NG+4, the hardest of this pass's four. FIRST-PASS STATS -
  // validate with
  //   node scripts/simulate-balance.js --cycle-sweep superBossFive
  // Base numbers produce, at NG+4 (hp x16, atk/def x2.44140625): effective
  // hp 6496 / atk 200 / def 39.
  superBossFive: {
    id: 'superBossFive', name: 'Super Boss Five [PLACEHOLDER NAME]', emoji: '🐲',
    hp: 406, attack: 82, defense: 16, speed: 16,
    xp: 1400, goldRange: [350, 500],
    dropTable: [{ itemId: 'guardiansLastStand', chance: 1, tier: 'apex' }],
    isSuperBoss: true,
    forceFullBattle: true,
    specialAttacks: [
      { type: 'stun', chancePerTurn: 0.3, durationMs: 1500 },
      { type: 'slow', chancePerTurn: 0.3, slowPercent: 35, durationMs: 5000 },
      { type: 'cooldownOverload', chancePerTurn: 0.25, gcdMs: 7000 },
    ],
    attackStyle: 'ranged', projectileEmoji: '❄️',
  },
```

- [ ] **Step 2: Run the test suite**

Run: `npm run test`
Expected: PASS — `tests/superBosses.test.js`'s existing generic checks (`'every monster flagged isSuperBoss has the required combat/loot shape'`, `'every SUPER_BOSSES entry whose monster has specialAttacks defines them with a well-formed shape'`) run automatically against these four new entries once they're referenced by `SUPER_BOSSES` in Task 8 — until then, these monster entries exist but aren't yet reachable from any `SUPER_BOSSES` entry, so those two tests won't see them yet. This step just confirms nothing else broke.

- [ ] **Step 3: Commit**

```bash
git add js/data/monsters.js CHANGELOG.md
git commit -m "feat: add four new superboss monster entries (superBossTwo through superBossFive)"
```

---

### Task 8: Add the four new `SUPER_BOSSES` registry entries

**Files:**
- Modify: `js/data/superBosses.js` (add four entries after `superBossOne`)

**Interfaces:**
- Consumes: `MONSTERS.superBossTwo` through `MONSTERS.superBossFive` (Task 7).
- Produces: `SUPER_BOSSES.superBossTwo` through `SUPER_BOSSES.superBossFive` — each starts inert (`screenId: null`), same convention as a fresh `TOOL_DUNGEON_ENTRANCES` entry before placement, until Timothy places it via `tools/terrain-painter/`'s "Place Super-Boss Marker" mode.

All four default to `hasDungeon: false` (open-wilderness marker, not a dungeon entrance) — authoring a brand-new, fully-reachable dungeon map per boss is real content-design work belonging to Timothy's own placement judgment (per the original superboss-pass spec's own precedent), not something this plan should invent. Any of the four can be converted to `hasDungeon: true` later using the existing "New Dungeon" terrain-painter mode from the original pass, with zero new code.

- [ ] **Step 1: Add the four entries**

In `js/data/superBosses.js`, after the existing `superBossOne` entry (before the closing `};`), add:
```js
  superBossTwo: {
    id: 'superBossTwo', monsterId: 'superBossTwo', screenId: null, x: null, y: null, hasDungeon: false, dungeonMapId: null,
    debutNgPlusCycle: 1,
  },
  superBossThree: {
    id: 'superBossThree', monsterId: 'superBossThree', screenId: null, x: null, y: null, hasDungeon: false, dungeonMapId: null,
    debutNgPlusCycle: 2,
  },
  superBossFour: {
    id: 'superBossFour', monsterId: 'superBossFour', screenId: null, x: null, y: null, hasDungeon: false, dungeonMapId: null,
    debutNgPlusCycle: 3,
  },
  superBossFive: {
    id: 'superBossFive', monsterId: 'superBossFive', screenId: null, x: null, y: null, hasDungeon: false, dungeonMapId: null,
    debutNgPlusCycle: 4,
  },
```

- [ ] **Step 2: Run the test suite**

Run: `npm run test`

Expected: PASS. This is the point where `tests/superBosses.test.js`'s generic checks first see all four new entries end to end: `'every SUPER_BOSSES entry has the required shape'` (including Task 4's new `debutNgPlusCycle` assertion), `'a not-yet-placed SUPER_BOSSES entry (null screenId) is inert everywhere that matches on screenId'`, `'every monster flagged isSuperBoss has the required combat/loot shape'`, and `'every SUPER_BOSSES entry whose monster has specialAttacks defines them with a well-formed shape'` all now exercise the four new bosses automatically, with no test-file changes needed for any of them.

- [ ] **Step 3: Commit**

```bash
git add js/data/superBosses.js CHANGELOG.md
git commit -m "feat: register four new superbosses, gated to NG+1 through NG+4"
```

---

### Task 9: Validate first-pass stats with `--cycle-sweep` and document the result

**Files:**
- Modify: `js/data/monsters.js` (only if the sweep shows a target badly missed — see Step 2)
- Modify: `docs/superpowers/specs/2026-09-13-superboss-expansion-design.md` (append validation results, mirroring how `superBossOne`'s own retune history is documented inline in `monsters.js`)

- [ ] **Step 1: Run the sweep for all four new bosses**

Run each of:
```bash
node scripts/simulate-balance.js --cycle-sweep superBossTwo --trials 2000
node scripts/simulate-balance.js --cycle-sweep superBossThree --trials 2000
node scripts/simulate-balance.js --cycle-sweep superBossFour --trials 2000
node scripts/simulate-balance.js --cycle-sweep superBossFive --trials 2000
```
For each boss, read its own debut cycle's row (e.g. `superBossTwo`'s NG+1 row, `superBossThree`'s NG+2 row, etc. — the other cycles' rows are informational, showing how it plays if a player lingers past its debut cycle).

- [ ] **Step 2: Compare against the design goal's target bands, and retune if badly off**

Target (from the spec's Phase 2 section): at debut-cycle `cycle-start` gear, roughly 15-30% average HP remaining with heavy potion use; at debut-cycle `cycle-ceiling` gear, a clear win but real resource spend (tens of potions is fine, not a problem) rather than a near-zero-cost win. If a boss's sweep numbers are far outside these bands (e.g. 0% or 100% win rate at either end), adjust that boss's `hp`/`attack` in `js/data/monsters.js` by a proportional amount (same iterative process `superBossOne`'s own two documented retune passes used) and re-run its sweep. Do not spend more than two retune passes per boss in this task — flag anything still off after that in the spec doc instead (Step 3) rather than iterating indefinitely; final tuning happens once Timothy has placed and actually fought each one, same as every prior superboss/dragon retune in this project's history.

- [ ] **Step 3: Record the outcome in the spec**

Append a short "Validation results (implementation)" section to the end of `docs/superpowers/specs/2026-09-13-superboss-expansion-design.md`, one paragraph per boss, naming the actual sweep numbers observed and whether/how the base stats were adjusted from Task 7's first pass — mirroring the level of detail in the existing comment above `MONSTERS.superBossOne` in `monsters.js`.

- [ ] **Step 4: Run the full test suite and commit**

Run: `npm run test`
Expected: PASS.

```bash
git add js/data/monsters.js docs/superpowers/specs/2026-09-13-superboss-expansion-design.md CHANGELOG.md
git commit -m "chore: validate and retune the four new superbosses' first-pass stats via --cycle-sweep"
```
(Only stage `js/data/monsters.js` if Step 2 actually changed it.)

---

### Task 10: Bump the version and ship Phase 2

**Files:**
- Modify: `CHANGELOG.md`, `js/data/playerChangelog.js`

- [ ] **Step 1: Bump the version**

This completes the design doc's plan (per `CHANGELOG.md`'s own versioning rule: "MINOR bumps for a completed feature/build... one bump per finished design-doc/plan") — bump `Unreleased` into a new dated **MINOR** version section in `CHANGELOG.md`, in the same developer-prose style as the original superboss pass's own `0.26.0` entry: what shipped (four new superbosses gated to NG+1-4, the simulator fixes and NG+-cycle gating plumbing that made them possible), and a pointer to this plan and the design spec.

- [ ] **Step 2: Add the player-facing changelog entry**

Add an entry to the top of `js/data/playerChangelog.js`'s `PLAYER_CHANGELOG` array for the same version. This one is genuinely player-visible — write a short, exciting `highlights` line about new superbosses appearing in New Game+ (no internal jargon, no mention of the simulator or gating mechanism — see this file's own header comment on what belongs here).

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS, including `tests/versionSync.test.js` (confirms `CHANGELOG.md`'s newest version matches `PLAYER_CHANGELOG[0].version`).

- [ ] **Step 4: Commit, push, and open the final PR**

```bash
git add CHANGELOG.md js/data/playerChangelog.js
git commit -m "chore: bump to vX.Y.0 for the superboss expansion"
```
Push the branch and open a PR summarizing all of Phase 2 (four new superbosses, their debut cycles, and a pointer to the spec's validation-results section from Task 9). Stop for review — do not merge; placement (screenId/x/y for each of the four, via `tools/terrain-painter/`) is Timothy's own next step, same as `superBossOne`'s original placement.

---

## Self-Review Notes

- **Spec coverage:** Phase 0 (0a special-parry-rate, 0b cycle-sweep) → Tasks 1-3. Phase 1 (gating plumbing + UX) → Tasks 4-5. Phase 2 (four bosses, per-cycle assignment, loot reuse + one new item) → Tasks 6-10. The spec's "Out of scope" section (retuning `superBossOne` itself, the remaining ~5 future superbosses, `bossTiers.js`/dragon changes, a new item tier) has no corresponding task, correctly.
- **Type consistency:** `isSuperBossDebuted(entry, ngPlusCycle)` and `getSuperBossNotYetMessage()` are defined once in Task 4 and consumed with the same names/signatures in Task 5. `maxedUpgrades(equipment, equipmentTiers, cycle = 0)`'s new signature from Task 1 is what Task 3's `runCycleSweep` calls. `runMatchup`'s new 5th parameter from Task 2 is what Task 3's `runCycleSweep` passes.
- **Placeholder scan:** all four new monster names are explicitly marked `[PLACEHOLDER NAME]`, matching `superBossOne`'s own shipped convention (a real, intentional pattern in this codebase, not a plan placeholder) — Timothy renames at authoring time. All stat numbers are concrete literals with derivations shown in comments, not blanks.
