// Economy: money, round awards and the buy menu. The menu is a DOM panel built here (styled
// like hud.js's elements), opened with B during freeze or the first 15 s of live; keys 1-5
// buy. state.economy is the single home for the numbers, as with everything else.
import { state } from './state.js';

const ITEMS = [
  { key: 'Digit1', name: 'Kiln-9', cost: 2700, kind: 'weapon', index: 0 },
  { key: 'Digit2', name: 'Ember', cost: 1200, kind: 'weapon', index: 1 },
  { key: 'Digit3', name: 'Judge', cost: 700, kind: 'weapon', index: 2 },
  { key: 'Digit4', name: 'Kilnpot', cost: 300, kind: 'grenade' },
  { key: 'Digit5', name: 'Kevlar', cost: 650, kind: 'kevlar' },
];

export function initEconomy() {
  state.economy = { money: 800, open: false, spent: 0 };
}

// Classic-style ceiling: no path may push money above this.
const MONEY_CAP = 16000;

export function award(kind) {
  const amounts = { kill: 300, win: 3250, loss: 1400, plant: 300 };
  state.economy.money = Math.min(MONEY_CAP, state.economy.money + (amounts[kind] ?? 0));
}

export function canOpen() {
  return state.round.phase === 'freeze'
    || (state.round.phase === 'live' && state.round.timer > 60 - 15);
}

// Buys one item; returns true when it went through. Applies immediately: weapon slots refill
// that weapon, Kilnpot adds a grenade, Kevlar sets the flag.
export function spend(item, weapons) {
  if (state.economy.money < item.cost) return false;
  state.economy.money = Math.min(MONEY_CAP, state.economy.money - item.cost);
  state.economy.spent += item.cost;
  if (item.kind === 'weapon') {
    const rec = weapons.WEAPONS[item.index];
    state.weapon.slots[item.index].mag = rec.mag;
    state.weapon.slots[item.index].reserve = rec.reserve;
  } else if (item.kind === 'grenade') {
    state.grenades.count = Math.min(3, state.grenades.count + 1);
  } else if (item.kind === 'kevlar') {
    state.player.kevlar = true;
    state.economy.kevlarRound = state.round.number; // rounds.js keeps it only this round
  }
  return true;
}

// The DOM panel. Returns a tiny controller: toggle/close/handleKey/refresh. Styled to match
// the HUD's minimal look without touching index.html.
export function createBuyMenu(weapons) {
  const panel = document.createElement('div');
  panel.id = 'buy-menu';
  panel.hidden = true;
  panel.style.cssText = 'position:absolute;left:50%;top:16%;transform:translateX(-50%);'
    + 'padding:14px 18px;background:rgba(20,18,16,.92);color:#eee;font:13px/1.6 monospace;'
    + 'border:1px solid #555;border-radius:6px;user-select:none;min-width:220px;';
  const title = document.createElement('div');
  title.textContent = 'BUY  (money 0)';
  title.style.cssText = 'font-weight:bold;margin-bottom:6px;';
  panel.appendChild(title);
  const rows = [];
  for (const item of ITEMS) {
    const row = document.createElement('div');
    row.textContent = `${item.key.slice(-1)}  ${item.name}  $${item.cost}`;
    panel.appendChild(row);
    rows.push(row);
  }
  const flash = document.createElement('div');
  flash.style.cssText = 'color:#f55;visibility:hidden;';
  flash.textContent = 'Not enough money';
  panel.appendChild(flash);
  document.getElementById('hud').appendChild(panel);
  let flashTimer = 0;

  return {
    toggle() { panel.hidden = !panel.hidden; state.economy.open = !panel.hidden; if (!panel.hidden) this.refresh(); },
    close() { panel.hidden = true; state.economy.open = false; },
    get open() { return !panel.hidden; },
    refresh() {
      title.textContent = `BUY  (money $${state.economy.money})`;
      for (let i = 0; i < ITEMS.length; i += 1) {
        rows[i].style.color = state.economy.money >= ITEMS[i].cost ? '#eee' : '#777';
      }
    },
    insufficientFlash() {
      flash.style.visibility = 'visible';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash.style.visibility = 'hidden'; }, 350);
    },
    // Keys 1-5 buy while open; returns true when the key was consumed.
    handleKey(code) {
      if (!this.open) return false;
      const item = ITEMS.find((entry) => entry.key === code);
      if (!item) return false;
      if (spend(item, weapons)) {
        this.refresh();
        return true;
      }
      this.insufficientFlash();
      return true;
    },
  };
}
