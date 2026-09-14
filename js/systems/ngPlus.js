import { ITEMS } from '../data/items.js';

// Raised from 2/1.25 on 2026-09-14 against real telemetry, not a guess: a
// real NG+2 level-20+ character (docs/superpowers/BACKLOG.md has the full
// numbers) was one-shotting regular fights and beating superBossFive in
// under 17s at full HP, while the *same* NG+2 cycle at level 18-19 two days
// earlier had been a real fight (superBossOne took 98-180s and was lost
// once). The old curve scales purely off ngPlusCycle with nothing
// accounting for in-cycle level/gear growth, so a player who keeps
// leveling within a cycle outgrows it fast - raised live: "even the
// regular monsters need like 4x hitpoints and 10x damage at this point...
// super bosses probably need to be harder and tool bosses in NG+."
// COMBAT_MULTIPLIER was the more lopsided of the two (1.25 vs HP's 2), so
// it moves further - both monster categories (regular monsters, tool
// guardians, superbosses) share this same function, so one change reaches
// all three at once. Not re-solved to hit the literal "4x/10x" numbers
// exactly at cycle 2 - doing that by cranking the exponent base would
// compound the SAME base every cycle (NG+ is intentionally endless, no
// ceiling), and squaring the base to land exactly on cycle 2 would make
// cycle 4+ absurd, and simulate-balance.js --cycle-sweep showed a
// COMBAT_MULTIPLIER of 2.5 already dropping NG+1's simulated ceiling build
// from 83% win to 0% - too sharp a jump on the very first cycle for how
// modest the actual ask was there. This is a real, felt increase (at
// cycle 2: HP 9x base instead of 4x, combat 4x instead of 1.5625x) without
// chasing an exact number derived from one data point. Real telemetry
// (see BACKLOG.md) already showed the pre-change numbers as reasonably
// tuned for a player at the cycle's own expected level - the actual bug is
// that nothing scales with in-cycle level/gear growth at all, so this is a
// stopgap for "too easy once over-leveled," not a full fix; that needs
// monster stats to factor in player level too, a bigger change than a
// live balance tweak should attempt without its own design pass.
export const NG_PLUS_HP_MULTIPLIER = 3;
export const NG_PLUS_COMBAT_MULTIPLIER = 2;
export const NG_PLUS_REWARD_MULTIPLIER = 1.5;
export const NG_PLUS_DROP_CHANCE_MULTIPLIER = 1.5;

// Uncapped 2026-09-01: NG+ used to stop offering at cycle 2 (MAX_NG_PLUS_CYCLE)
// while getNgPlusCombatOverrides/getNgPlusRewardMultiplier/scaleDropTable below
// kept scaling forever regardless - a maxed-gear player hit a wall with nothing
// left to chase. There's no ceiling check left anywhere in this file now; the
// climb is intentionally endless.
export function canStartNgPlus(state) {
  return Boolean(state.flags.dungeonBossDefeated);
}

export function getNgPlusCombatOverrides(baseMonster, cycle) {
  const hpMultiplier = NG_PLUS_HP_MULTIPLIER ** cycle;
  const combatMultiplier = NG_PLUS_COMBAT_MULTIPLIER ** cycle;
  return {
    hp: Math.round(baseMonster.hp * hpMultiplier),
    attack: Math.round(baseMonster.attack * combatMultiplier),
    defense: Math.round(baseMonster.defense * combatMultiplier),
    speed: baseMonster.speed,
  };
}

export function getNgPlusRewardMultiplier(cycle) {
  const multiplier = NG_PLUS_REWARD_MULTIPLIER ** cycle;
  return { gold: multiplier, xp: multiplier };
}

export function scaleDropTable(dropTable, cycle) {
  const multiplier = NG_PLUS_DROP_CHANCE_MULTIPLIER ** cycle;
  const isTool = (entry) => ITEMS[entry.itemId] && ITEMS[entry.itemId].type === 'tool';

  const scaled = dropTable.map((entry) => (
    isTool(entry) ? entry : { ...entry, chance: entry.chance * multiplier }
  ));

  const total = scaled.reduce((sum, entry) => (isTool(entry) ? sum : sum + entry.chance), 0);
  if (total <= 1) return scaled;

  return scaled.map((entry) => (
    isTool(entry) ? entry : { ...entry, chance: entry.chance / total }
  ));
}

const isToolItem = (itemId) => Boolean(ITEMS[itemId] && ITEMS[itemId].type === 'tool');

// Raised 2026-08-29: "NG+ should reset the tools you have otherwise you can
// go straight to dragon." Confirmed the tools form a strict earn-in-order
// chain (axe -> pick -> canoe -> dragon, per Timothy directly) - without
// this, a player who already owns every tool and has already cleared every
// tool gate keeps both across an NG+ reset, walking straight to the
// dungeon entrance with none of zone 1's tool-gated obstacles in the way.
// Both inventory and clearedGates reset together (Timothy's call,
// 2026-08-29) so NG+ reproduces the exact same reachability graph a
// brand-new save starts with - re-fighting each tool guardian already works
// with zero extra code (the guardian tile has no "already defeated" flag),
// this just makes that refight actually necessary again.
export function resetWorldForNgPlus(state) {
  return {
    ...state,
    flags: { ...state.flags, dungeonBossDefeated: false },
    inventory: state.inventory.filter((entry) => !isToolItem(entry.itemId)),
    clearedGates: {},
    // Deliberately NOT reset, unlike every other world-progress field
    // below - Timothy wants the worn-path trails kept across NG+ cycles
    // rather than every screen starting blank again. No longer purely
    // cosmetic as of the worn-path encounter discount (js/screens/
    // mapScreen.js, see docs/superpowers/specs/2026-09-12-worn-path-
    // encounter-discount-design.md): a well-trodden zone-1 screen keeps its
    // discount into NG+2+ too, deliberately - Timothy's own call was "no
    // special NG+ handling" for that discount, on the reasoning that
    // reaching a fully-paved screen already took real, sustained play
    // regardless of cycle.
    seenScreens: {},
    caches: {},
    gateRewards: {},
    miniDungeons: {},
    activeMiniDungeon: null,
    bossTier: 0,
    map: 'center',
    position: null,
    lossStreak: 0,
    zone1Steps: 0,
    ngPlusCycle: state.ngPlusCycle + 1,
  };
}

// One-time migration for saves already mid-NG+-cycle from before the fix
// above existed - resetWorldForNgPlus has never stripped tools until now,
// so any save currently at ngPlusCycle >= 1 holding tools got every one of
// them via carryover, with no legitimate "re-earned it this cycle" case to
// protect against false-positive stripping. Scoped to inventory only, not a
// retroactive clearedGates revert - re-gating terrain out from under a save
// already mid-playthrough is a bigger, more disruptive surprise than this
// migration is meant to cause; a clearedGates reset only applies
// prospectively, at each future NG+ transition (resetWorldForNgPlus above).
// Guarded by ngPlusToolsMigrated so it only ever runs once per save - without
// it, this would re-confiscate a tool the player legitimately re-earned
// after the first migration, on every subsequent load.
export function migrateNgPlusToolCarryover(state) {
  if (state.ngPlusToolsMigrated) return state;
  if (state.ngPlusCycle < 1) return { ...state, ngPlusToolsMigrated: true };
  return {
    ...state,
    inventory: state.inventory.filter((entry) => !isToolItem(entry.itemId)),
    ngPlusToolsMigrated: true,
  };
}
