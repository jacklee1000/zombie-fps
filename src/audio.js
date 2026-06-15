// ---------------------------------------------------------------------------
// Procedural audio engine.
//
// Every sound is synthesized purely in code with the Web Audio API (oscillators
// + noise) — no external sound files. Each one is rendered offline into a PCM
// buffer, encoded to an in-memory WAV data URI, and wrapped in a Howler `Howl`,
// so Howler handles playback, looping, per-sound volume, and global mute.
// ---------------------------------------------------------------------------
import { Howl, Howler } from 'howler';
import { images } from './assets.js';

const SR = 44100;

// Render an offline audio graph and resolve with the rendered AudioBuffer.
function render(seconds, build, sampleRate = SR) {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  build(ctx);
  return ctx.startRendering();
}

function noiseBuffer(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// Encode an AudioBuffer as a 16-bit PCM mono WAV data URI.
function bufferToWavURI(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const ab = new ArrayBuffer(44 + len * ch * 2);
  const view = new DataView(ab);
  let o = 0;
  const ws = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i)); };
  ws('RIFF'); view.setUint32(o, 36 + len * ch * 2, true); o += 4; ws('WAVE');
  ws('fmt '); view.setUint32(o, 16, true); o += 4;
  view.setUint16(o, 1, true); o += 2; view.setUint16(o, ch, true); o += 2;
  view.setUint32(o, sr, true); o += 4; view.setUint32(o, sr * ch * 2, true); o += 4;
  view.setUint16(o, ch * 2, true); o += 2; view.setUint16(o, 16, true); o += 2;
  ws('data'); view.setUint32(o, len * ch * 2, true); o += 4;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      let s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  let bin = '';
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

// ---------------------------------------------------------------------------
// Individual sound synths — each returns a Promise<AudioBuffer>.
// ---------------------------------------------------------------------------

// 1. SHOTGUN — loud low boom: filtered noise blast + sub thump.
const synthShotgun = () => render(0.45, (ctx) => {
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.45);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2200, 0); lp.frequency.exponentialRampToValueAtTime(280, 0.28);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(1, 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, 0.4);
  n.connect(lp).connect(g).connect(ctx.destination); n.start(0);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(130, 0); o.frequency.exponentialRampToValueAtTime(42, 0.2);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.85, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.32);
  o.connect(g2).connect(ctx.destination); o.start(0); o.stop(0.32);
});

// 2. MACHINE GUN — short sharp crack (rapid fire layers these).
const synthMachineGun = () => render(0.13, (ctx) => {
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.13);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.1);
  n.connect(bp).connect(g).connect(ctx.destination); n.start(0);
  const o = ctx.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(240, 0); o.frequency.exponentialRampToValueAtTime(80, 0.08);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.5, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.09);
  o.connect(g2).connect(ctx.destination); o.start(0); o.stop(0.1);
});

// 3. RELOAD — two metallic clicks ("click-clack").
const synthReload = () => render(0.42, (ctx) => {
  const click = (t, freq) => {
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.06);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(bp).connect(g).connect(ctx.destination); n.start(t); n.stop(t + 0.06);
  };
  click(0, 2700);
  click(0.16, 2100);
});

// 4. ZOMBIE GROAN — low guttural saw with a wobble.
const synthGroan = () => render(0.95, (ctx) => {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620;
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 88;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
  const lg = ctx.createGain(); lg.gain.value = 13; lfo.connect(lg).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.7, 0.15);
  g.gain.setValueAtTime(0.7, 0.55); g.gain.exponentialRampToValueAtTime(0.001, 0.95);
  o.connect(lp); o.connect(g).connect(ctx.destination);
  o.start(0); o.stop(0.95); lfo.start(0); lfo.stop(0.95);
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 58;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, 0); g2.gain.exponentialRampToValueAtTime(0.22, 0.2);
  g2.gain.exponentialRampToValueAtTime(0.001, 0.85);
  o2.connect(lp); o2.connect(g2).connect(ctx.destination); o2.start(0); o2.stop(0.95);
});

// 5. ZOMBIE DEATH — descending scream + wet splat.
const synthDeath = () => render(0.7, (ctx) => {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(420, 0); o.frequency.exponentialRampToValueAtTime(70, 0.6);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.5, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.6);
  o.connect(lp).connect(g).connect(ctx.destination); o.start(0); o.stop(0.6);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.3);
  const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, 0); g2.gain.exponentialRampToValueAtTime(0.6, 0.02);
  g2.gain.exponentialRampToValueAtTime(0.001, 0.3);
  n.connect(lp2).connect(g2).connect(ctx.destination); n.start(0);
});

// 6. PLAYER HIT — short pained grunt.
const synthPlayerHit = () => render(0.26, (ctx) => {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(185, 0); o.frequency.exponentialRampToValueAtTime(110, 0.2);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.6, 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, 0.22);
  o.connect(lp).connect(g).connect(ctx.destination); o.start(0); o.stop(0.26);
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.1);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.3, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.1);
  n.connect(g2).connect(ctx.destination); n.start(0);
});

// 7. EMPTY GUN — dry high click.
const synthEmpty = () => render(0.07, (ctx) => {
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.07);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.5, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.045);
  n.connect(hp).connect(g).connect(ctx.destination); n.start(0);
});

// 8. FOOTSTEP — soft low thud.
const synthFootstep = () => render(0.16, (ctx) => {
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.16);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(420, 0); lp.frequency.exponentialRampToValueAtTime(120, 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.5, 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, 0.14);
  n.connect(lp).connect(g).connect(ctx.destination); n.start(0);
});

// 9. DARK HORROR MUSIC — seamless low drone loop with eerie swells (22kHz to
// keep the data URI small).
const synthMusic = () => render(8, (ctx) => {
  const base = 55; // A1
  [base, base * 1.5, base * 2].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = f * (1 + i * 0.003);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0;
    const off = ctx.createConstantSource(); off.offset.value = 0.09 - i * 0.02;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08 + i * 0.03;
    const lg = ctx.createGain(); lg.gain.value = 0.05;
    off.connect(g.gain); lfo.connect(lg).connect(g.gain);
    o.connect(lp).connect(g).connect(ctx.destination);
    o.start(0); o.stop(8); off.start(0); off.stop(8); lfo.start(0); lfo.stop(8);
  });
  // distant eerie high tones
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 659;
  const g2 = ctx.createGain(); g2.gain.value = 0.0001;
  [1.5, 4.8].forEach((t) => {
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.045, t + 0.6);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
  });
  o2.connect(g2).connect(ctx.destination); o2.start(0); o2.stop(8);
}, 22050);

// 10. WAVE START — rising minor chord stab + timpani hit.
const synthWaveStart = () => render(1.3, (ctx) => {
  const root = 110;
  [root, root * 1.189, root * 1.498].forEach((f) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.5, 0); o.frequency.exponentialRampToValueAtTime(f, 0.3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(800, 0); lp.frequency.exponentialRampToValueAtTime(3200, 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.22, 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, 1.25);
    o.connect(lp).connect(g).connect(ctx.destination); o.start(0); o.stop(1.3);
  });
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(80, 0); o.frequency.exponentialRampToValueAtTime(45, 0.4);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.8, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.5);
  o.connect(g).connect(ctx.destination); o.start(0); o.stop(0.5);
});

// 11. GAME OVER — slow descending dissonant chord.
const synthGameOver = () => render(2.3, (ctx) => {
  [220, 174.6, 130.8].forEach((f) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, 0); o.frequency.exponentialRampToValueAtTime(f * 0.5, 2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, 0); lp.frequency.exponentialRampToValueAtTime(300, 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.22, 0.1);
    g.gain.setValueAtTime(0.22, 1.2); g.gain.exponentialRampToValueAtTime(0.001, 2.2);
    o.connect(lp).connect(g).connect(ctx.destination); o.start(0); o.stop(2.3);
  });
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(70, 0); o.frequency.exponentialRampToValueAtTime(34, 1.6);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.7, 0); g.gain.exponentialRampToValueAtTime(0.001, 2);
  o.connect(g).connect(ctx.destination); o.start(0); o.stop(2.1);
});

// 12. PICKUP — bright two-note "blip-bloop" power-up chime.
const synthPickup = () => render(0.32, (ctx) => {
  const note = (t, freq) => {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.18);
  };
  note(0, 660);    // E5
  note(0.09, 988); // B5
});

// 13. HITMARKER — tiny crisp tick confirming a shot connected.
const synthHitmarker = () => render(0.06, (ctx) => {
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.06);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.04);
  n.connect(bp).connect(g).connect(ctx.destination); n.start(0);
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1400;
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.25, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.03);
  o.connect(g2).connect(ctx.destination); o.start(0); o.stop(0.04);
});

// Per-sound base volumes — tuned so nothing is harsh.
const VOL = {
  shotgun: 0.45, machinegun: 0.26, reload: 0.5, groan: 0.5, death: 0.5,
  hit: 0.55, empty: 0.4, footstep: 0.22, music: 0.32, wave: 0.5, gameover: 0.65,
  pickup: 0.5, hitmarker: 0.3,
};

const SYNTHS = {
  shotgun: synthShotgun, machinegun: synthMachineGun, reload: synthReload,
  groan: synthGroan, death: synthDeath, hit: synthPlayerHit, empty: synthEmpty,
  footstep: synthFootstep, music: synthMusic, wave: synthWaveStart, gameover: synthGameOver,
  pickup: synthPickup, hitmarker: synthHitmarker,
};

class AudioEngine {
  constructor() {
    this.howls = {};
    this.ready = false;
    this.musicMuted = false;
    this._musicId = null;
  }

  // Render every sound up front (offline rendering needs no user gesture).
  async init() {
    if (this.ready || this._initing) return;
    this._initing = true;
    Howler.volume(0.9); // master
    const files = (images && images.sounds) || {};
    const entries = await Promise.all(
      Object.entries(SYNTHS).map(async ([key, synth]) =>
        // Prefer a real audio file for this category; otherwise synthesize one.
        files[key] ? [key, { url: files[key] }] : [key, { buffer: await synth() }]
      )
    );
    for (const [key, src] of entries) {
      const opts = { volume: VOL[key], loop: key === 'music' };
      if (src.url) {
        opts.src = [src.url]; // real file — let Howler infer format from the URL
      } else {
        opts.src = [bufferToWavURI(src.buffer)];
        opts.format = ['wav'];
      }
      this.howls[key] = new Howl(opts);
    }
    this.ready = true;
  }

  _play(key) {
    if (this.ready && this.howls[key]) return this.howls[key].play();
    return null;
  }

  shot(weaponKey) { this._play(weaponKey === 'machinegun' ? 'machinegun' : 'shotgun'); }
  reload() { this._play('reload'); }
  death() { this._play('death'); }
  playerHit() { this._play('hit'); }
  empty() { this._play('empty'); }
  footstep() { this._play('footstep'); }
  waveStart() { this._play('wave'); }
  gameOver() { this._play('gameover'); }
  pickup() { this._play('pickup'); }
  hitmarker() { this._play('hitmarker'); }

  // Distance-attenuated groan (0..1 closeness scales the volume).
  groan(closeness = 1) {
    const id = this._play('groan');
    if (id != null) this.howls.groan.volume(VOL.groan * Math.max(0.12, Math.min(1, closeness)), id);
  }

  startMusic() {
    if (!this.ready || this.musicMuted) return;
    const m = this.howls.music;
    if (!m.playing(this._musicId)) this._musicId = m.play();
  }

  stopMusic() {
    if (this.ready) this.howls.music.stop();
    this._musicId = null;
  }

  // M key: mute/unmute just the background music.
  toggleMusicMute() {
    this.musicMuted = !this.musicMuted;
    if (this.ready) {
      if (this.musicMuted) this.howls.music.pause();
      else this.startMusic();
    }
    return this.musicMuted;
  }
}

export const audio = new AudioEngine();
