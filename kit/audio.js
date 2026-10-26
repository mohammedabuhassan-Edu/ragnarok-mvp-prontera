// audio.js — a code-only synth: sound effects and a tiny music sequencer.
//
// No audio files. Everything is built from oscillators, filtered noise and
// envelopes, mixed through a soft compressor and a short generated reverb so
// the result sounds rounded rather than "raw beep".
//
// Browsers (iOS especially) only allow sound after a user gesture. The
// context is created suspended and unlock() runs on the first pointerdown /
// touchend / keydown anywhere on the page. Without Web Audio (Node tests,
// very old browsers) every method is a safe no-op and `ctx` is null.

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export { midiToHz };

const NOOP_HANDLE = { setRate() {}, setVolume() {}, stop() {} };

export function createAudio({ volume = 0.8 } = {}) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) {
    return {
      ctx: null, muted: false, bus: null, musicBus: null,
      unlock() {}, sfx() { return NOOP_HANDLE; }, music() { return { stop() {}, setVolume() {} }; },
      mute() {}, setVolume() {}, connect(node) { return node; },
    };
  }

  const ctx = new AC({ latencyHint: 'interactive' });

  // ---------------------------------------------------------------- mix bus
  //  sfx ─┐                     ┌─> reverb (send) ─┐
  //       ├─> compressor ─> master ─────────────────┴─> speakers
  //  music┘
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 14;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  comp.connect(master);

  const sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(comp);
  const musicBus = ctx.createGain(); musicBus.gain.value = 0.42; musicBus.connect(comp);

  // A short stereo reverb from decaying noise: adds "room" to every sound.
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 1.4, 3.2);
  const reverbOut = ctx.createGain(); reverbOut.gain.value = 0.5;
  reverb.connect(reverbOut); reverbOut.connect(comp);

  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  // ---------------------------------------------------------------- unlock
  let userMuted = false;
  let level = volume;
  let unlocked = false;
  const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
  function unlock() {
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!unlocked) {
      // iOS: playing a silent buffer inside the gesture fully unlocks output.
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
      unlocked = true;
    }
    if (ctx.state === 'running') removeGestureListeners();
  }
  const onGesture = () => unlock();
  function removeGestureListeners() {
    for (const ev of GESTURES) globalThis.removeEventListener?.(ev, onGesture, true);
  }
  for (const ev of GESTURES) globalThis.addEventListener?.(ev, onGesture, true);
  ctx.onstatechange = () => { if (ctx.state === 'running') removeGestureListeners(); };

  // Pause sound with the tab; resume when it comes back (if it was unlocked).
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
    else if (unlocked) ctx.resume().catch(() => {});
  });

  // ---------------------------------------------------------------- voices
  const now = () => ctx.currentTime;

  /**
   * One enveloped oscillator. Times in seconds, relative to `when` (0 = now).
   * Square and sawtooth waves always pass a lowpass so they stay warm.
   */
  function tone({
    wave = 'triangle', freq = 440, freqEnd, dur = 0.15, vol = 0.3, attack = 0.006,
    when = 0, detune = 0, filter, q = 0.8, send = 0.15, pan = 0, vibrato = 0, bus = sfxBus,
  } = {}) {
    const t0 = now() + when;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd && freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur * 0.9);
    if (vibrato) {
      const lfo = ctx.createOscillator(); const lg = ctx.createGain();
      lfo.frequency.value = 6; lg.gain.value = freq * vibrato;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    const cutoff = filter ?? (wave === 'square' || wave === 'sawtooth' ? 3200 : 0);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = q;
      node.connect(f); node = f;
    }
    node.connect(g);
    route(g, bus, send, pan);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Filtered white noise with an envelope and an optional filter sweep. */
  function noise({
    dur = 0.2, vol = 0.3, type = 'lowpass', freq = 1200, freqEnd, q = 0.9, attack = 0.004,
    when = 0, send = 0.15, pan = 0, bus = sfxBus,
  } = {}) {
    const t0 = now() + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true; // the random start offset below may run past the 1 s buffer
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g);
    route(g, bus, send, pan);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  function route(node, bus, send, pan) {
    let out = node;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      out.connect(p); out = p;
    }
    out.connect(bus);
    if (send > 0) {
      const s = ctx.createGain(); s.gain.value = send;
      out.connect(s); s.connect(reverb);
    }
  }

  // ---------------------------------------------------------------- sfx recipes
  const N = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, B5: 987.77, E6: 1318.5, G4: 392, Eb4: 311.13, C4: 261.63, B3: 246.94 };
  const RECIPES = {
    jump() {
      tone({ wave: 'triangle', freq: 300, freqEnd: 720, dur: 0.2, vol: 0.32 });
      tone({ wave: 'sine', freq: 600, freqEnd: 1440, dur: 0.12, vol: 0.07 });
    },
    coin() {
      tone({ wave: 'square', freq: N.B5, dur: 0.08, vol: 0.09, filter: 4200 });
      tone({ wave: 'triangle', freq: N.B5, dur: 0.08, vol: 0.18 });
      tone({ wave: 'square', freq: N.E6, dur: 0.34, vol: 0.09, filter: 4200, when: 0.07, send: 0.3 });
      tone({ wave: 'sine', freq: N.E6 * 2, dur: 0.22, vol: 0.05, when: 0.07, send: 0.3 });
    },
    hit() {
      noise({ type: 'bandpass', freq: 1100, freqEnd: 500, dur: 0.12, vol: 0.4, q: 1.2 });
      tone({ wave: 'sine', freq: 190, freqEnd: 60, dur: 0.16, vol: 0.5, send: 0.05 });
    },
    boom() {
      noise({ type: 'lowpass', freq: 2200, freqEnd: 60, dur: 1.1, vol: 0.75, q: 0.6, send: 0.35 });
      tone({ wave: 'sine', freq: 95, freqEnd: 28, dur: 0.8, vol: 0.65, send: 0.1 });
      noise({ type: 'highpass', freq: 2500, dur: 0.06, vol: 0.2 });
    },
    shoot() {
      tone({ wave: 'sawtooth', freq: 1150, freqEnd: 170, dur: 0.14, vol: 0.14, filter: 2600 });
      tone({ wave: 'sine', freq: 520, freqEnd: 120, dur: 0.1, vol: 0.14 });
      noise({ type: 'highpass', freq: 3200, dur: 0.04, vol: 0.09 });
    },
    click() {
      tone({ wave: 'sine', freq: 1500, freqEnd: 950, dur: 0.05, vol: 0.16, attack: 0.002, send: 0.05 });
    },
    win() {
      const seq = [N.C5, N.E5, N.G5, N.C6];
      seq.forEach((f, i) => {
        const last = i === seq.length - 1;
        tone({ wave: 'triangle', freq: f, dur: last ? 0.9 : 0.3, vol: 0.22, when: i * 0.1, send: 0.35 });
        tone({ wave: 'sine', freq: f * 2, dur: last ? 0.7 : 0.2, vol: 0.06, when: i * 0.1, send: 0.35 });
      });
      tone({ wave: 'sine', freq: N.E5, dur: 0.9, vol: 0.12, when: 0.3, send: 0.4 });
    },
    lose() {
      const seq = [N.G4, N.Eb4, N.C4, N.B3];
      seq.forEach((f, i) => {
        const last = i === seq.length - 1;
        tone({ wave: 'triangle', freq: f, freqEnd: last ? f * 0.94 : f, dur: last ? 0.85 : 0.26, vol: 0.24, when: i * 0.17, send: 0.3, vibrato: last ? 0.012 : 0 });
      });
    },
    powerup() {
      for (let i = 0; i < 6; i++) tone({ wave: 'triangle', freq: 400 * Math.pow(1.19, i), dur: 0.12, vol: 0.16, when: i * 0.045, send: 0.25 });
    },
    boost() {
      noise({ type: 'bandpass', freq: 400, freqEnd: 2600, dur: 0.45, vol: 0.32, q: 1.6, send: 0.2 });
      tone({ wave: 'sine', freq: 110, freqEnd: 220, dur: 0.4, vol: 0.2 });
    },
    engine() { return engine(); },
  };

  // Stops the same sound from stacking dozens of times in one frame.
  const lastPlayed = new Map();

  /**
   * sfx('coin') plays a built-in sound; sfx({wave,freq,freqEnd,dur,vol,...}) plays
   * a custom tone; sfx({noise:true, ...}) plays filtered noise.
   * sfx('engine') returns a continuous handle { setRate(0..1), setVolume(v), stop() }.
   */
  function sfx(nameOrParams, opts) {
    if (typeof nameOrParams === 'string') {
      if (nameOrParams === 'engine') return engine(opts);
      const r = RECIPES[nameOrParams];
      if (!r) return NOOP_HANDLE;
      const t = now();
      if (t - (lastPlayed.get(nameOrParams) ?? -1) < 0.03) return NOOP_HANDLE;
      lastPlayed.set(nameOrParams, t);
      r();
      return NOOP_HANDLE;
    }
    if (nameOrParams && typeof nameOrParams === 'object') {
      if (nameOrParams.noise) noise(nameOrParams); else tone(nameOrParams);
    }
    return NOOP_HANDLE;
  }

  // ---------------------------------------------------------------- engine (continuous)
  function engine({ vol = 0.14 } = {}) {
    const t0 = now();
    const out = ctx.createGain(); out.gain.value = 0.0001;
    out.gain.setTargetAtTime(vol, t0, 0.15);
    // Two detuned oscillators an octave apart give a growly but smooth tone.
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.detune.value = 8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.2;
    // Amplitude "chug": a sine LFO wobbling the level like firing cylinders.
    const am = ctx.createGain(); am.gain.value = 0.75;
    const lfo = ctx.createOscillator(); lfo.type = 'sine';
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.25;
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain);
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    lp.connect(am); am.connect(out); out.connect(sfxBus);
    let stopped = false;
    const set = (r) => {
      r = Math.max(0, Math.min(1, r));
      const f = 42 + r * 115;
      const t = now();
      o1.frequency.setTargetAtTime(f, t, 0.06);
      o2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      lp.frequency.setTargetAtTime(320 + r * 1700, t, 0.08);
      lfo.frequency.setTargetAtTime(9 + r * 26, t, 0.08);
    };
    set(0);
    o1.start(t0); o2.start(t0); lfo.start(t0);
    return {
      setRate: (r) => { if (!stopped) set(r); },
      setVolume: (v) => { if (!stopped) out.gain.setTargetAtTime(v, now(), 0.08); },
      stop() {
        if (stopped) return;
        stopped = true;
        const t = now();
        out.gain.setTargetAtTime(0.0001, t, 0.06);
        for (const o of [o1, o2, lfo]) o.stop(t + 0.4);
      },
    };
  }

  // ---------------------------------------------------------------- music
  // score = { bpm, loop=true, length?(beats), tracks:[{ wave, vol?, notes:[[t,len,midi,vel]] }] }
  // t and len are in beats. wave: sine|triangle|square|sawtooth|pluck|pad|bass|kick|snare|hat
  let current = null;

  function playNote(wave, at, durSec, midi, vel, vol) {
    const v = vol * (vel ?? 0.8);
    const when = Math.max(0, at - now());
    const f = midiToHz(midi);
    switch (wave) {
      case 'kick':
        tone({ wave: 'sine', freq: 150, freqEnd: 42, dur: 0.28, vol: v * 1.1, when, send: 0, bus: musicBus });
        break;
      case 'snare':
        noise({ type: 'highpass', freq: 1400, dur: 0.16, vol: v * 0.6, when, send: 0.2, bus: musicBus });
        tone({ wave: 'triangle', freq: 200, freqEnd: 140, dur: 0.1, vol: v * 0.4, when, send: 0.1, bus: musicBus });
        break;
      case 'hat':
        noise({ type: 'highpass', freq: 7500, dur: 0.045, vol: v * 0.3, when, send: 0.05, bus: musicBus });
        break;
      case 'pluck':
        tone({ wave: 'triangle', freq: f, dur: Math.min(durSec, 0.45), vol: v * 0.5, when, send: 0.3, bus: musicBus });
        tone({ wave: 'square', freq: f, dur: Math.min(durSec, 0.12), vol: v * 0.12, filter: 2000, when, send: 0.3, bus: musicBus });
        break;
      case 'pad':
        tone({ wave: 'sawtooth', freq: f, dur: durSec + 0.3, vol: v * 0.14, attack: Math.min(0.25, durSec * 0.4), filter: 1100, detune: -7, when, send: 0.45, bus: musicBus });
        tone({ wave: 'sawtooth', freq: f, dur: durSec + 0.3, vol: v * 0.14, attack: Math.min(0.25, durSec * 0.4), filter: 1100, detune: 7, when, send: 0.45, bus: musicBus });
        break;
      case 'bass':
        tone({ wave: 'sawtooth', freq: f, dur: durSec * 0.95, vol: v * 0.32, filter: 520, q: 3, when, send: 0.05, bus: musicBus });
        tone({ wave: 'sine', freq: f, dur: durSec * 0.95, vol: v * 0.3, when, send: 0, bus: musicBus });
        break;
      default:
        tone({ wave, freq: f, dur: Math.max(0.05, durSec * 0.95), vol: v * 0.35, attack: 0.01, when, send: 0.25, bus: musicBus });
    }
  }

  function music(score) {
    if (current) current.stop();
    current = null;
    if (!score || !Array.isArray(score.tracks)) return { stop() {}, setVolume() {} };

    const spb = 60 / (score.bpm || 110);
    let end = 0;
    for (const tr of score.tracks) for (const n of tr.notes || []) end = Math.max(end, n[0] + n[1]);
    const length = score.length || Math.max(4, Math.ceil(end / 4) * 4);
    const loop = score.loop !== false;
    const LOOKAHEAD = 0.18; // seconds scheduled ahead of the audio clock
    let startAt = now() + 0.08;
    let cursor = 0;          // beats scheduled so far (absolute, across loops)
    let stopped = false;

    function schedule() {
      if (stopped) return;
      if (ctx.state !== 'running') { startAt = now() + 0.08 - cursor * spb; return; }
      const horizon = (now() + LOOKAHEAD - startAt) / spb;
      while (cursor < horizon) {
        const iter = Math.floor(cursor / length);
        if (!loop && iter >= 1) { api.stop(); return; }
        const segEnd = Math.min(horizon, (iter + 1) * length);
        const a = cursor - iter * length, b = segEnd - iter * length;
        for (const tr of score.tracks) {
          const vol = tr.vol ?? 0.6;
          for (const n of tr.notes || []) {
            if (n[0] >= a && n[0] < b) playNote(tr.wave || 'triangle', startAt + (iter * length + n[0]) * spb, n[1] * spb, n[2], n[3], vol);
          }
        }
        cursor = segEnd;
      }
    }
    const timer = setInterval(schedule, 30);
    schedule();
    const api = {
      stop() { stopped = true; clearInterval(timer); if (current === api) current = null; },
      setVolume(v) { musicBus.gain.setTargetAtTime(v, now(), 0.1); },
      get playing() { return !stopped; },
    };
    current = api;
    return api;
  }

  /**
   * Route a game's own audio node (a custom engine hum, a loop) through the Kit mix,
   * so it gets the compressor, the master volume and mute().
   * opts.bus: 'sfx' (default) | 'music'; opts.send: reverb send 0..1 (default 0).
   */
  function connect(node, { bus = 'sfx', send = 0, pan = 0 } = {}) {
    if (!node || typeof node.connect !== 'function') return node;
    route(node, bus === 'music' ? musicBus : sfxBus, send, pan);
    return node;
  }

  return {
    ctx,
    unlock,
    sfx,
    music,
    connect,
    /** the effects bus (a GainNode inside the Kit mix); connect(node) is the safer call */
    bus: sfxBus,
    musicBus,
    mute(b = true) {
      userMuted = !!b;
      master.gain.setTargetAtTime(userMuted ? 0 : level, now(), 0.03);
    },
    setVolume(v) { level = v; if (!userMuted) master.gain.setTargetAtTime(v, now(), 0.03); },
    get muted() { return userMuted; },
  };
}

// Stereo impulse response: exponentially decaying noise, slightly different
// per channel for width.
function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
