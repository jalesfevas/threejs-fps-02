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
    title: 'Range cleared',
    copy: 'Every dummy is down.',
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
  };
}
