// js/screens/dpsChartScreen.js
// "Let's make sure we have a log of battle DPS and an in game chart so you
// can compare how you are doing over time on regular mobs and bosses as you
// go through NG+ to see if you are getting strong" - reads the telemetry
// buffer's battle_end events (js/systems/telemetry.js, already durable
// across sessions) and plots DPS per fight in chronological order, colored
// by category, with NG+ cycle boundaries marked so progress across cycles is
// visible at a glance.
//
// Data prep lives in js/systems/dpsChartData.js, kept pure and separately
// tested - jsdom has no canvas 2D context (mapCanvasRenderer.js's own
// comment explains why), so this file's actual drawing isn't unit tested,
// same split as js/systems/mapDrawList.js vs. js/screens/mapCanvasRenderer.js.
// The canvas also carries its computed points as plain DOM fallback content
// (children of the <canvas> tag) rather than only as pixels - real browsers
// don't render that content once canvas is supported, but it's still part of
// the DOM, which is what lets tests/dpsChartScreenDom.test.js assert "did the
// right number of boss/superboss/regular points get plotted" without a real
// canvas, and it doubles as this chart's only accessible/text fallback.
import { getBufferedEvents } from '../systems/telemetry.js';
import { buildDpsChartPoints, findCycleBoundaries, CATEGORY_COLORS } from '../systems/dpsChartData.js';
import { bindEscapeClose, bindBackdropClose } from './dialogChrome.js';

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 320;
const PADDING_LEFT = 44;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 32;

let rootEl = null;
let callbacks = null;
let unbindEscape = null;
let unbindBackdrop = null;

function categoryLabel(category) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function legendHtml() {
  return Object.keys(CATEGORY_COLORS).map((category) => `
    <span class="dps-chart-legend-item">
      <span class="dps-chart-legend-swatch" style="background:${CATEGORY_COLORS[category]}"></span>
      ${categoryLabel(category)}
    </span>
  `).join('');
}

// Fallback content for the <canvas> tag itself - see this file's header for
// why this exists (accessibility fallback that doubles as a jsdom-testable
// stand-in for pixels no test can inspect). One marker per point, tagged
// with its category so a colored-CSS class and a data attribute both make it
// checkable without reaching into canvas internals.
function pointMarkersHtml(points) {
  return points.map((point) => `<span class="dps-chart-point dps-chart-point-${point.category}" data-dps="${point.dps.toFixed(1)}" data-ng-plus-cycle="${point.ngPlusCycle}"></span>`).join('');
}

function render() {
  const points = buildDpsChartPoints(getBufferedEvents());
  const cycleBoundaries = findCycleBoundaries(points);
  const hasPoints = points.length > 0;

  rootEl.innerHTML = `
    <div class="overlay-panel dps-chart-panel">
      <button class="screen-close-x" id="btn-close-x" aria-label="Close">✕</button>
      <h2>DPS Over Time</h2>
      <div class="dps-chart-legend">${legendHtml()}</div>
      ${hasPoints ? `
        <canvas id="dps-chart-canvas" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" aria-label="DPS per battle, in order fought">${pointMarkersHtml(points)}</canvas>
      ` : `
        <p id="dps-chart-empty-state">No battles logged yet - fight something, then check back here.</p>
      `}
      <button id="btn-close-dps-chart">Close</button>
    </div>
  `;

  if (hasPoints) {
    paintChart(document.getElementById('dps-chart-canvas'), points, cycleBoundaries);
  }

  document.getElementById('btn-close-dps-chart').onclick = () => callbacks.onClose();
  document.getElementById('btn-close-x').onclick = () => callbacks.onClose();
}

// No-op under jsdom (getContext('2d') returns null there - see this file's
// header), so render() above stays testable without a browser. Deliberately
// simple per the brainstormed scope: axis lines, a connecting line, colored
// dots, dashed cycle-boundary markers - a v1 for eyeballing trends, not a
// polished analytics product.
function paintChart(canvas, points, cycleBoundaries) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const plotWidth = CANVAS_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = CANVAS_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const maxDps = Math.max(1, ...points.map((point) => point.dps));
  const xFor = (index) => PADDING_LEFT + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (dps) => PADDING_TOP + plotHeight - (dps / maxDps) * plotHeight;

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Axis lines.
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_LEFT, PADDING_TOP);
  ctx.lineTo(PADDING_LEFT, PADDING_TOP + plotHeight);
  ctx.lineTo(PADDING_LEFT + plotWidth, PADDING_TOP + plotHeight);
  ctx.stroke();

  // Y-axis labels (0 and the current max) - just enough to read the scale,
  // not a full tick ladder.
  ctx.fillStyle = '#aaa';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(maxDps.toFixed(0), PADDING_LEFT - 6, PADDING_TOP + 4);
  ctx.fillText('0', PADDING_LEFT - 6, PADDING_TOP + plotHeight);

  // NG+ cycle boundary markers - a dashed vertical line plus its new cycle
  // number, so "did DPS actually climb once NG+ ramped back up" reads as a
  // shape instead of something to cross-reference by hand.
  ctx.strokeStyle = '#888';
  ctx.setLineDash([4, 4]);
  ctx.textAlign = 'center';
  for (const boundaryIndex of cycleBoundaries) {
    const x = xFor(boundaryIndex);
    ctx.beginPath();
    ctx.moveTo(x, PADDING_TOP);
    ctx.lineTo(x, PADDING_TOP + plotHeight);
    ctx.stroke();
    ctx.fillText(`NG+${points[boundaryIndex].ngPlusCycle}`, x, PADDING_TOP + 10);
  }
  ctx.setLineDash([]);

  // Connecting line across every fight in order, then colored dots on top -
  // the line shows the trend, the dot color shows what kind of fight it was.
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((point, i) => {
    const x = xFor(i);
    const y = yFor(point.dps);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  for (const point of points) {
    ctx.fillStyle = CATEGORY_COLORS[point.category] || CATEGORY_COLORS.regular;
    ctx.beginPath();
    ctx.arc(xFor(point.index), yFor(point.dps), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function mount(root, props) {
  rootEl = root;
  callbacks = props.callbacks;
  render();
  unbindEscape = bindEscapeClose(() => callbacks.onClose());
  unbindBackdrop = bindBackdropClose(rootEl, () => callbacks.onClose());
}

export function unmount() {
  unbindEscape?.();
  unbindBackdrop?.();
}
