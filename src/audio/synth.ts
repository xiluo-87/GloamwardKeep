import type { GameEventType, RunState } from '../sim/state';

/** Everything is synthesised with Web Audio; there are no sample files. */

/** Hard cap on simultaneously scheduled voices. */
const MAX_VOICES = 16;
/** The pad is quiet and sits well under the effects. */
const DRONE_GAIN = 0.12;
/** Pad notes: C3 and G3, a perfect fifth apart. */
const PAD_NOTES = [130.81, 196];
/** Notes for the five ability indices (A2, D3, G3, C3, E3). */
const ABILITY_NOTES = [110, 146.83, 196, 130.81, 164.81];

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private osc: OscillatorNode[] = [];
  private noise: AudioBuffer | null = null;
  private voices = 0;
  /** Seconds of frame time seen so far. Throttles use this, so they work before audio starts. */
  private clock = 0;
  private last: Record<string, number> = {};
  /** Set by stopRun; cleared when a fresh run reaches wave 0. */
  private stopped = false;
  muted = false;

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    // A warm lowpass keeps the pad soft.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(this.droneGain);
    this.droneGain.connect(this.master);
    for (const freq of PAD_NOTES) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      o.connect(g);
      g.connect(lp);
      o.start();
      this.osc.push(o);
    }
    const buf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  /** Returns true, and starts the throttle window, if `key` has not played within `gap` seconds. */
  private ready(key: string, gap: number): boolean {
    const prev = this.last[key];
    if (prev !== undefined && this.clock - prev < gap) return false;
    this.last[key] = this.clock;
    return true;
  }

  private schedule(src: AudioScheduledSourceNode, t: number, end: number): void {
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(t);
    src.stop(end);
  }

  /** A plain oscillator with an exponential decay. A non-zero glideTo sweeps the pitch down or up. */
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, glideTo = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.voices >= MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo > 0) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    this.schedule(o, t, t + dur);
  }

  /** A slow rise and fall, for big moments such as abilities. */
  private swell(freq: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.voices >= MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    this.schedule(o, t, t + dur);
  }

  /** Filtered noise. The filter can sweep from `freq` to `toFreq` over the duration. */
  private burst(freq: number, dur: number, gain: number, delay = 0, toFreq = freq): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise || this.voices >= MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(freq, t);
    if (toFreq !== freq) f.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    this.schedule(src, t, t + dur);
  }

  private bell(pitch = 1, delay = 0): void {
    for (const [m, g] of [[1, 0.16], [2.01, 0.09], [2.76, 0.06], [5.4, 0.025]]) {
      this.tone(392 * pitch * m, 1.1 / Math.sqrt(m), g, 'sine', delay);
    }
  }

  /** Soft UI click. */
  click(): void {
    this.tone(620, 0.05, 0.06, 'triangle');
  }

  /** Fades the drone out. It stays silent until a fresh run starts. */
  stopRun(): void {
    this.stopped = true;
    if (this.droneGain && this.ctx) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  /** Called once per frame with the events the sim emitted since the last frame. */
  update(s: RunState, frameDt: number): void {
    this.clock += frameDt;
    if (s.wave === 0) this.stopped = false;
    if (!this.ctx || !this.droneGain) return;

    const now = this.ctx.currentTime;
    const active = s.wave > 0 && !s.outcome && !this.stopped;
    this.droneGain.gain.setTargetAtTime(active ? DRONE_GAIN : 0, now, active ? 1.2 : 0.5);

    for (let i = 0; i < s.eventCount; i++) {
      const e = s.events[i];
      this.play(e.type, e.a, e.b);
    }
  }

  private play(type: GameEventType, a: number, b: number): void {
    switch (type) {
      case 'shot':
        // Arrow twang: a short string pluck that drops in pitch.
        if (this.ready('shot', 0.04)) {
          this.tone(480 + Math.random() * 60, 0.12, 0.05, 'triangle', 0, 240);
          this.burst(3500, 0.03, 0.012);
        }
        break;
      case 'hit':
        if (this.ready('hit', 0.05)) this.burst(1400 + Math.random() * 1200, 0.04, 0.025);
        break;
      case 'kill':
        if (this.ready('kill', 0.03)) {
          if (a > 0) {
            // Gold drop: a brighter coin-like ping.
            this.tone(1319, 0.16, 0.035, 'sine');
            this.tone(1976, 0.22, 0.025, 'sine', 0.05);
          } else {
            this.tone(392 + Math.random() * 120, 0.22, 0.045, 'triangle');
          }
        }
        break;
      case 'leak':
        this.tone(58, 0.4, 0.3, 'sine');
        // A tritone pair for the dissonance.
        this.tone(146.83, 0.5, 0.05, 'triangle');
        this.tone(207.65, 0.5, 0.05, 'triangle');
        break;
      case 'splash':
      case 'cluster':
        if (this.ready('boom', 0.06)) {
          this.burst(260, 0.4, 0.16, 0, 90);
          this.tone(55, 0.35, 0.12, 'sine');
        }
        break;
      case 'pulse':
        // Frost or holy shimmer: two close high sines beating, with a soft airy overtone.
        if (this.ready('pulse', 0.12)) {
          this.tone(1318.5, 0.55, 0.03, 'sine');
          this.tone(1323.5, 0.55, 0.03, 'sine');
          this.tone(1975.5, 0.4, 0.014, 'sine', 0.08);
        }
        break;
      case 'chain':
        // Lightning: a crackly noise burst with a quick second crack.
        if (this.ready('chain', 0.03)) {
          this.burst(2500, 0.12, 0.07, 0, 600);
          this.burst(4000, 0.05, 0.04, 0.04);
        }
        break;
      case 'cleave':
        // Sword swish: noise sweeping down.
        if (this.ready('cleave', 0.05)) this.burst(2200, 0.14, 0.07, 0, 900);
        break;
      case 'bite':
        // Hawk strike: a tiny chirp that falls away, heavily throttled.
        if (this.ready('bite', 0.3)) this.tone(2600, 0.05, 0.012, 'sine', 0, 1500);
        break;
      case 'smash':
        // Wood or stone thud.
        if (this.ready('smash', 0.15)) {
          this.tone(90, 0.15, 0.2, 'sine', 0, 45);
          this.burst(500, 0.08, 0.06, 0, 200);
        }
        break;
      case 'destroyed':
        // Crumbling burst and a low thud. A hero falling is heavier and always plays.
        if (a === 1 || this.ready('destroyed', 0.05)) {
          this.burst(900, 0.6, 0.12, 0, 150);
          this.tone(60, 0.5, 0.25, 'sine', 0, 35);
          if (a === 1) {
            this.tone(45, 0.9, 0.22, 'sine', 0.05, 30);
            this.burst(400, 0.9, 0.1, 0.1, 80);
          }
        }
        break;
      case 'clear':
        // Chopping (forest) or cracking stone (rocks), then a soft rustle.
        this.burst(a === 1 ? 700 : 300, 0.12, 0.12, 0, a === 1 ? 300 : 120);
        this.burst(a === 1 ? 900 : 400, 0.12, 0.1, 0.14, a === 1 ? 300 : 120);
        this.burst(2000, 0.35, 0.04, 0.3, 800);
        break;
      case 'build':
        this.tone(280, 0.09, 0.2, 'triangle', 0, 160);
        this.burst(1200, 0.02, 0.06);
        break;
      case 'upgrade':
        this.tone(523.25, 0.16, 0.07, 'triangle');
        this.tone(783.99, 0.24, 0.07, 'triangle', 0.09);
        break;
      case 'sell':
        this.tone(783.99, 0.16, 0.06, 'triangle');
        this.tone(523.25, 0.24, 0.06, 'triangle', 0.09);
        break;
      case 'skill':
        this.tone(1046.5, 0.45, 0.045, 'sine');
        this.tone(1568, 0.55, 0.025, 'sine', 0.06);
        break;
      case 'wave':
        this.bell(0.5);
        this.tone(65.41, 1.6, 0.12, 'sine');
        break;
      case 'waveClear':
        this.tone(261.63, 1.4, 0.05, 'sine');
        this.tone(329.63, 1.4, 0.04, 'sine', 0.04);
        this.tone(392, 1.4, 0.04, 'sine', 0.08);
        break;
      case 'heroLevel':
        this.tone(523.25, 0.35, 0.06, 'triangle');
        this.tone(659.25, 0.35, 0.06, 'triangle', 0.09);
        this.tone(783.99, 0.4, 0.06, 'triangle', 0.18);
        break;
      case 'ability': {
        const idx = Math.min(ABILITY_NOTES.length - 1, Math.max(0, Math.floor(b)));
        const note = ABILITY_NOTES[idx];
        this.swell(note, 1.8, 0.1);
        this.swell(note * 1.5, 1.6, 0.04, 0.12);
        this.bell(note / 392, 0.15);
        break;
      }
      case 'shield':
        // Two close tones beat against each other, which gives the shimmer.
        this.tone(1568, 0.7, 0.025, 'sine');
        this.tone(1576, 0.7, 0.025, 'sine');
        this.tone(2349, 0.5, 0.012, 'sine', 0.06);
        break;
      case 'silence':
        // A low muffled swoosh: noise sweeping down into the mud.
        this.burst(500, 0.6, 0.08, 0, 180);
        break;
      case 'jinx':
        // Short eerie warble: two dissonant tones sliding down.
        if (this.ready('jinx', 0.2)) {
          this.tone(311, 0.3, 0.035, 'sine', 0, 220);
          this.tone(370, 0.3, 0.02, 'sine', 0.05, 277);
        }
        break;
      case 'boss':
        this.tone(41.2, 2.6, 0.07, 'sawtooth');
        this.tone(43.65, 2.6, 0.05, 'sawtooth');
        break;
      case 'win':
        this.bell(1.5);
        this.bell(2, 0.25);
        break;
      case 'lose':
        this.tone(220, 0.7, 0.09, 'triangle');
        this.tone(174.61, 0.9, 0.09, 'triangle', 0.35);
        this.tone(130.81, 1.4, 0.09, 'triangle', 0.75);
        break;
      case 'gold':
        if (this.ready('gold', 0.06)) this.tone(1318.5, 0.08, 0.025, 'sine');
        break;
      case 'shed':
        if (this.ready('shed', 0.08)) {
          this.burst(700, 0.1, 0.05, 0, 400);
          this.tone(196, 0.12, 0.05, 'triangle');
        }
        break;
      default:
        break;
    }
  }
}
