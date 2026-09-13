// Gates a superboss encounter on how far into New Game+ the player has
// gotten, parallel in spirit to js/systems/toolGates.js's hasRequiredTool -
// but keyed on state.ngPlusCycle instead of inventory, since a superboss
// encounter was never a required crossing to block (it's always optional,
// off the beaten path), just something that shouldn't be reachable yet.
// See docs/superpowers/specs/2026-09-13-superboss-expansion-design.md.
export function isSuperBossDebuted(entry, ngPlusCycle) {
  return ngPlusCycle >= (entry.debutNgPlusCycle ?? 0);
}

// One generic message, unlike toolGates.js's per-tool messages - there's no
// per-superboss variation needed yet (no player-facing name/flavor to plug
// in until Timothy authors one), so this stays a plain function for now
// rather than a lookup table with a single entry.
export function getSuperBossNotYetMessage() {
  return "You sense something powerful here, but it hasn't stirred yet. Perhaps it's waiting for you to grow stronger.";
}
