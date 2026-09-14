// js/systems/battleStats.js
// Pure helpers that turn a battle's monster roster and raw numbers into the
// fields the battle_end telemetry event (and the DPS chart that reads it
// back) actually want. Kept out of main.js/battleScreen.js so they're
// unit-testable with no DOM/telemetry plumbing - same split as
// js/systems/mapDrawList.js's pure data prep vs. its canvas painter.
import { MONSTERS } from '../data/monsters.js';

// 'superboss' outranks 'boss', which outranks 'regular' - today's encounters
// never actually mix tiers (superbosses are always solo, per
// js/data/superBosses.js), but classifying by the most dangerous monster
// present is the right rule if that ever changes, rather than silently
// reading a mixed group as merely 'boss' or 'regular'.
export function classifyBattleCategory(monsterIds) {
  if (monsterIds.some((id) => MONSTERS[id]?.isSuperBoss)) return 'superboss';
  if (monsterIds.some((id) => MONSTERS[id]?.isBoss)) return 'boss';
  return 'regular';
}

// durationMs is real wall-clock time (Date.now() delta in main.js), so a
// battle that somehow logs as 0ms (or a negative/missing value from bad
// data) would otherwise divide into Infinity/NaN - neither is a meaningful
// "rate", so this reports 0 DPS instead of polluting the chart with an
// unplottable value.
export function computeDps(totalDamageDealt, durationMs) {
  if (!durationMs || durationMs <= 0) return 0;
  return totalDamageDealt / (durationMs / 1000);
}
