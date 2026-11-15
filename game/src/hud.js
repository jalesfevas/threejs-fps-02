// The DOM HUD: weapon name, ammo, reload bar, grenade count, crosshair, hit marker, score and
// the one overlay panel. It never touches the simulation; main.js pushes numbers in every
// render frame and every setter caches its last value, so unchanged DOM is never rewritten.
const COPY = {
  start: {
    title: 'Kiln Yard',
    copy: 'A ceramics yard at dusk: two lanes, a courtyard and two friendlies against three enemies. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Kiln Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: 'Final score is in the top HUD.',
    action: 'Play again',
  },
};

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const weaponName = document.getElementById('weapon-name');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const reloadBar = document.getElementById('reload-bar');
  const reloadFill = document.getElementById('reload-fill');
  const grenadeCount = document.getElementById('grenade-count');
  const scoreValue = document.getElementById('score-value');
  const crosshair = document.getElementById('crosshair');
  const hitmarker = document.getElementById('hitmarker');
  const killFeed = document.getElementById('kill-feed');
  let hitTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastScore = -1;
  let lastWeapon = '';
  let lastReload = -2; // -1 is the hidden state, so start one step away
  let lastGrenades = -1;
  let lastGap = -1;

  // Round HUD, built here so index.html stays untouched: timer, score, money, banner,
  // objective progress bar and the death line.
  const roundHud = document.createElement('div');
  roundHud.id = 'round-hud';
  roundHud.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);'
    + 'text-align:center;color:#eee;font:13px/1.5 monospace;text-shadow:0 1px 2px #000;';
  const timerText = document.createElement('div');
  timerText.id = 'round-timer';
  const scoreText = document.createElement('div');
  scoreText.id = 'round-score';
  const moneyText = document.createElement('div');
  moneyText.id = 'money';
  roundHud.append(timerText, scoreText, moneyText);
  const banner = document.createElement('div');
  banner.id = 'banner';
  banner.style.cssText = 'position:absolute;top:26%;left:50%;transform:translateX(-50%);'
    + 'color:#fff;font:bold 20px monospace;text-shadow:0 1px 3px #000;white-space:nowrap;';
  banner.hidden = true;
  const progress = document.createElement('div');
  progress.id = 'objective-progress';
  progress.hidden = true;
  progress.style.cssText = 'position:absolute;bottom:22%;left:50%;transform:translateX(-50%);'
    + 'width:220px;height:10px;border:1px solid #999;background:rgba(0,0,0,.5);';
  const progressFill = document.createElement('div');
  progressFill.style.cssText = 'height:100%;width:0%;background:#e9a23b;';
  progress.appendChild(progressFill);
  // Health, bottom-left above the score line: one bar + number, plus a kevlar tag that
  // only exists once armour is bought.
  const healthWrap = document.createElement('div');
  healthWrap.id = 'health';
  healthWrap.style.cssText = 'position:absolute;left:32px;bottom:92px;'
    + 'display:flex;align-items:center;gap:8px;font:13px/1 monospace;color:#98a0a8;';
  const healthBar = document.createElement('div');
  healthBar.id = 'health-bar';
  healthBar.style.cssText = 'width:140px;height:6px;background:#2c323a;border-radius:2px;overflow:hidden;';
  const healthFill = document.createElement('div');
  healthFill.id = 'health-fill';
  healthFill.style.cssText = 'height:100%;width:100%;background:#e9e6df;';
  healthBar.appendChild(healthFill);
  const healthValue = document.createElement('span');
  healthValue.id = 'health-value';
  healthValue.style.cssText = 'color:#e9e6df;font-size:16px;';
  healthValue.textContent = '100';
  const armorTag = document.createElement('span');
  armorTag.id = 'armor-tag';
  armorTag.hidden = true;
  armorTag.textContent = 'kevlar';
  healthWrap.append(healthBar, healthValue, armorTag);
  const dead = document.createElement('div');
  dead.id = 'death-line';
  dead.hidden = true;
  dead.style.cssText = 'position:absolute;top:36%;left:50%;transform:translateX(-50%);'
    + 'color:#f55;font:bold 26px monospace;text-shadow:0 1px 3px #000;';
  dead.textContent = 'YOU DIED — waiting for round end';
  const hudRoot = document.getElementById('hud');
  hudRoot.append(roundHud, banner, progress, dead, healthWrap);
  let lastTimer = -1;
  let lastRoundScore = '';
  let lastMoney = -1;
  let lastProgress = -2;
  let lastLabel = '';
  let lastHealth = -1;
  let lastArmor = null;

  return {
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    // progress 0..1 while reloading, -1 when the weapon is ready; DOM moves only in 2% steps.
    setReload(progress) {
      const step = progress < 0 ? -1 : Math.round(progress * 50) / 50;
      if (step === lastReload) return;
      lastReload = step;
      if (step < 0) {
        reloadBar.hidden = true;
        return;
      }
      reloadBar.hidden = false;
      reloadFill.style.width = `${Math.round(step * 100)}%`;
    },
    setGrenades(count) {
      if (count === lastGrenades) return;
      lastGrenades = count;
      grenadeCount.textContent = String(count);
    },
    // Gap in px; cached at 1 px resolution so the crosshair style is not churned every frame.
    setCrosshair(gapPx) {
      const gap = Math.round(gapPx);
      if (gap === lastGap) return;
      lastGap = gap;
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    setScore(value) {
      if (value === lastScore) return;
      lastScore = value;
      scoreValue.textContent = String(value);
    },
    hitMarker(killed, headshot, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('head', headshot);
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.classList.remove('head');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    // One fading kill-feed line per kill; removed after the fade completes.
    addKill(name) {
      const line = document.createElement('div');
      line.className = 'line';
      line.textContent = `${name} down`;
      killFeed.replaceChildren(line);
      requestAnimationFrame(() => line.classList.add('fading'));
      setTimeout(() => line.remove(), 2600);
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' ? `${text.copy} You scored ${score}.` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    // Round timer in m:ss, cached at 1 s resolution.
    setRoundTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      if (s === lastTimer) return;
      lastTimer = s;
      timerText.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },
    // Score line "2 - 1" plus round number.
    setRound(number, score) {
      const text = `Round ${number}   ${score[0]} - ${score[1]}`;
      if (text === lastRoundScore) return;
      lastRoundScore = text;
      scoreText.textContent = text;
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyText.textContent = `$${value}`;
    },
    setBanner(text) {
      if (!text) {
        banner.hidden = true;
        return;
      }
      banner.hidden = false;
      banner.textContent = text;
    },
    // progress 0..1 with a label; -1 hides. Cached so the DOM moves in 2% steps.
    setProgress(value, label) {
      const step = value < 0 ? -1 : Math.round(value * 50) / 50;
      if (step === lastProgress && label === lastLabel) return;
      lastProgress = step;
      lastLabel = label;
      if (step < 0) {
        progress.hidden = true;
        return;
      }
      progress.hidden = false;
      progressFill.style.width = `${Math.round(step * 100)}%`;
    },
    setSpectate(show) {
      dead.hidden = !show;
    },
    // Health 0..100 with the armour flag; DOM moves in whole-point steps, colour drops to
    // the danger tone under 30, and the kevlar tag appears only once armour is bought.
    setHealth(health, kevlar) {
      const hp = Math.max(0, Math.min(100, Math.round(health)));
      if (hp !== lastHealth) {
        lastHealth = hp;
        healthValue.textContent = String(hp);
        healthFill.style.width = `${hp}%`;
        healthFill.style.background = hp < 30 ? '#e0503c' : '#e9e6df';
      }
      if (kevlar !== lastArmor) {
        lastArmor = kevlar;
        armorTag.hidden = !kevlar;
      }
    },
    showMatchEnd(score, playerTeam = 0) {
      // score is [attackers, defenders]; the player's team is attackers only in the first
      // half — pass state.round.playerTeam so the verdict follows the side actually played.
      const ours = score[playerTeam];
      const theirs = score[1 - playerTeam];
      this.showOverlay('end', ours);
      title.textContent = ours > theirs ? 'VICTORY' : 'DEFEAT';
      copy.textContent = `Final score ${ours} - ${theirs}.`;
      banner.hidden = true;
    },
  };
}
