// js/systems/dpsChartData.js
// Turns the telemetry buffer's raw battle_end events into plot-ready points
// for the DPS chart screen (js/screens/dpsChartScreen.js). Pure: no canvas,
// no DOM - jsdom has no canvas 2D context (see mapCanvasRenderer.js's own
// comment on that), so this mirrors js/systems/mapDrawList.js's split from
// its painter, keeping the actual data prep unit-testable even though the
// painting itself isn't.
export const CATEGORIES = ['regular', 'boss', 'superboss'];

// Bright enough to read against the dark .overlay-panel background
// (css/styles.css), each distinct at a glance and in a colorblind-safe-ish
// blue/orange/red spread - no existing palette in this codebase to match,
// since no other screen distinguishes monster tiers by color.
export const CATEGORY_COLORS = {
  regular: '#7fb2e0',
  boss: '#f0a742',
  superboss: '#e5484d',
};

// Filters a mixed telemetry buffer (every logged event type, not just
// battles) down to the battle_end events that actually carry a dps field -
// older saves' persisted buffers can still hold pre-DPS-tracking battle_end
// events (this repo doesn't migrate historical telemetry), so those are
// skipped rather than plotted as a false zero. Order matches the buffer's
// own append order (logEvent always pushes), i.e. chronological.
//
// Also drops totalDamageDealt: 0 fights - main.js logs a battle_end even for
// the weak-mob instant-resolve path (a whole group outclassed enough to skip
// the real battle screen entirely, see handleEncounter's own comment), which
// carries 0 damage and ~0 duration by construction. That's not a fight with
// a 0 DPS *result*, it's a non-fight, and plotting it as a real 0 sample
// would make the chart read as "DPS collapsing" exactly when the player is
// strong enough to stop needing to fight at all - the opposite of what this
// chart exists to show.
export function buildDpsChartPoints(events) {
  return events
    .filter((event) => event.type === 'battle_end' && typeof event.dps === 'number' && event.totalDamageDealt > 0)
    .map((event, index) => ({
      index,
      dps: event.dps,
      category: CATEGORIES.includes(event.category) ? event.category : 'regular',
      ngPlusCycle: event.ngPlusCycle ?? 0,
      ts: event.ts,
    }));
}

// Indices where a point's ngPlusCycle differs from the point right before
// it - the chart draws a vertical marker at each one, so "did DPS actually
// climb once NG+ ramped the monsters back up" is visible as a shape, not
// something you have to cross-reference by hand. The first point never
// counts as a boundary (nothing to compare it against).
export function findCycleBoundaries(points) {
  const boundaries = [];
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].ngPlusCycle !== points[i - 1].ngPlusCycle) boundaries.push(i);
  }
  return boundaries;
}
