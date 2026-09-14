import { ITEMS } from '../data/items.js';
import { xpForLevel } from '../systems/leveling.js';
import { getEquipmentBonuses, physicalKeysFor } from '../systems/inventory.js';
import { tierLabel } from '../systems/itemQuality.js';
import { bindEscapeClose, bindBackdropClose } from './dialogChrome.js';

const FIXED_SLOTS = ['weapon', 'head', 'body', 'legs'];

// "Ring N" / "Charm N" labels generated from the physical key itself, so
// they scale with however many slots the current NG+ cycle has unlocked
// (see ringSlotCount/accessorySlotCount in inventory.js) instead of only
// covering the original fixed pair.
function slotLabel(slot) {
  const match = /^(ring|accessory)(\d+)$/.exec(slot);
  if (!match) return slot;
  return `${match[1] === 'ring' ? 'Ring' : 'Charm'} ${match[2]}`;
}

function equipmentSlots(currentState) {
  return [
    ...FIXED_SLOTS,
    ...physicalKeysFor('accessory', currentState.ngPlusCycle),
    ...physicalKeysFor('ring', currentState.ngPlusCycle),
  ];
}

let rootEl = null;
let state = null;
let callbacks = null;
let unbindEscape = null;
let unbindBackdrop = null;

function render() {
  const bonuses = getEquipmentBonuses(state);
  const xpNeeded = xpForLevel(state.player.level);

  const equipRows = equipmentSlots(state).map((slot) => {
    const itemId = state.equipment[slot];
    const label = slotLabel(slot);
    if (!itemId) return `<div class="stats-slot">${label}: (empty)</div>`;
    const item = ITEMS[itemId];
    const level = state.upgrades?.[itemId] || 0;
    const tier = state.equipmentTiers?.[slot];
    return `<div class="stats-slot">${label}: ${item.emoji} ${tierLabel(tier)}${item.name} +${level}</div>`;
  }).join('');

  const effectRows = [
    bonuses.lifestealPercent > 0 ? `<div>Lifesteal: ${bonuses.lifestealPercent}%</div>` : '',
    bonuses.extraSwingChance > 0 ? `<div>Extra Swing Chance: ${bonuses.extraSwingChance}%</div>` : '',
    bonuses.elementalProcChance > 0 ? `<div>Elemental Proc: ${bonuses.elementalProcChance}% chance, +${bonuses.elementalProcDamage} dmg</div>` : '',
    bonuses.thornsPercent > 0 ? `<div>Thorns: ${bonuses.thornsPercent}%</div>` : '',
    bonuses.parryWindowBonusPercent > 0 ? `<div>Parry Window: +${bonuses.parryWindowBonusPercent}%</div>` : '',
    bonuses.debuffDurationPercent > 0 ? `<div>Debuff Resist: ${bonuses.debuffDurationPercent}%</div>` : '',
  ].join('');

  const ngPlusBadge = state.ngPlusCycle > 0 ? `<div class="ngplus-badge">New Game+${state.ngPlusCycle}</div>` : '';

  rootEl.innerHTML = `
    <div class="overlay-panel stats-panel">
      <button class="screen-close-x" id="btn-close-x" aria-label="Close">✕</button>
      <h2>Stats</h2>
      ${ngPlusBadge}
      <div>Level ${state.player.level} (XP ${state.player.xp}/${xpNeeded})</div>
      <div>HP: ${state.player.hp}/${state.player.maxHp + bonuses.maxHp}</div>
      <div>Attack: ${state.player.attack + bonuses.attack}</div>
      <div>Defense: ${state.player.defense + bonuses.defense}</div>
      <div>Speed: ${state.player.speed + bonuses.speed}</div>
      <div>Gold: ${state.player.gold}</div>
      ${effectRows}
      <h3>Equipment</h3>
      ${equipRows}
      <button id="btn-close-stats">Close</button>
    </div>
  `;

  document.getElementById('btn-close-stats').onclick = () => callbacks.onClose();
  document.getElementById('btn-close-x').onclick = () => callbacks.onClose();
}

export function mount(root, props) {
  rootEl = root;
  state = props.state;
  callbacks = props.callbacks;
  render();
  unbindEscape = bindEscapeClose(() => callbacks.onClose());
  unbindBackdrop = bindBackdropClose(rootEl, () => callbacks.onClose());
}

export function unmount() {
  unbindEscape?.();
  unbindBackdrop?.();
}
