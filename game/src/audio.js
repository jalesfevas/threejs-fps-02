// Synthesized audio — one lazily created AudioContext, no files, no network. Every play
// function is a silent no-op until initAudio() runs on the first user gesture (the pointer
// lock click), which is what the autoplay policy requires; nothing here can throw into the
// sim. All sound routes through one low master gain.
let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.22; // low master: shots bark, never blast
    master.connect(ctx.destination);
  } catch {
    ctx = null; // no audio device: stay silent
  }
}

function ready() {
  return ctx && ctx.state === 'running' ? ctx : null;
}

// White-noise buffer built once and reused by every burst.
function noise(c) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.3), c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// One shot: a filtered noise crack plus a pitchy body thump. pitch scales per weapon
// (Kiln-9 low, Ember snappy, Judge mid) so the three guns are tellable apart.
export function gunshot(pitch) {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400 * pitch;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.7, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  src.connect(filter).connect(gain).connect(master);
  const thump = c.createOscillator();
  thump.type = 'triangle';
  thump.frequency.setValueAtTime(150 * pitch, t);
  thump.frequency.exponentialRampToValueAtTime(50, t + 0.09);
  const thumpGain = c.createGain();
  thumpGain.gain.setValueAtTime(0.5, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  thump.connect(thumpGain).connect(master);
  src.start(t);
  src.stop(t + 0.16);
  thump.start(t);
  thump.stop(t + 0.12);
}

// Magazine click: one tiny square blip.
export function reloadClick() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 1900;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.06);
}

// Footstep: a soft low-passed noise tap, quiet by design.
export function footstep() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.playbackRate.value = 0.5 + Math.random() * 0.2;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + 0.1);
}

// Round sting: a rising major arpeggio on a round win, a falling minor one on a loss.
export function sting(win) {
  const c = ready();
  if (!c) return;
  const notes = win ? [330, 415, 494] : [392, 330, 262];
  notes.forEach((freq, index) => {
    const t = c.currentTime + index * 0.12;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}
