import { RunState } from '../sim/state';

/** Everything is synthesised with Web Audio; there are no sample files. */
export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private osc: OscillatorNode[] = [];
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private lastPluck = 0;
  private lastHit = 0;
  private beat = 0;
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
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.connect(this.droneGain);
    this.droneGain.connect(this.master);
    for (const detune of [-7, 5, 1200]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 62;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = detune === 1200 ? 0.03 : 0.08;
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

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    if (!this.ctx || !this.master || this.voices > 14) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    this.voices++;
    o.onended = () => { this.voices--; };
    o.start(t);
    o.stop(t + dur);
  }

  private burst(freq: number, dur: number, gain: number): void {
    if (!this.ctx || !this.master || !this.noise || this.voices > 14) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(t, Math.random() * 0.3, dur);
  }

  bell(pitch = 1): void {
    for (const [m, g] of [[1, 0.16], [2.01, 0.09], [2.76, 0.06], [5.4, 0.025]]) this.tone(392 * pitch * m, 1.1 / Math.sqrt(m), g);
  }

  click(): void {
    this.tone(520, 0.08, 0.08, 'triangle');
  }

  stopRun(): void {
    if (this.droneGain && this.ctx) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  /** Called once per frame with the events the sim emitted since the last frame. */
  update(s: RunState, frameDt: number): void {
    if (!this.ctx || !this.droneGain) return;
    const now = this.ctx.currentTime;
    const inversion = s.boss?.phase === 3 && !s.bossDead;
    const quiet = inversion || s.bossDead;
    // The drone drops in pitch through the night, and falls silent for the last phase.
    this.droneGain.gain.setTargetAtTime(quiet ? 0 : 0.55, now, quiet ? 0.15 : 0.8);
    const f = 66 - (s.t / 900) * 24;
    for (const o of this.osc) o.frequency.setTargetAtTime(f, now, 1);

    // A low heartbeat when oil is below 20.
    if (s.player.oil < 20 && !s.bossDead) {
      this.beat -= frameDt;
      if (this.beat <= 0) {
        this.beat = 1.05;
        this.tone(58, 0.16, 0.34);
        this.tone(50, 0.2, 0.26, 'sine', 0.19);
      }
    }

    for (let i = 0; i < s.eventCount; i++) {
      const e = s.events[i];
      switch (e.type) {
        case 'hit':
          if (now - this.lastHit > 0.05) {
            this.lastHit = now;
            this.burst(800 + Math.random() * 1600, 0.05, 0.035);
          }
          break;
        case 'pickup':
          if (now - this.lastPluck > 0.05) {
            this.lastPluck = now;
            this.tone(700 + Math.random() * 500, 0.07, 0.03, 'triangle');
          }
          break;
        case 'oil':
          this.tone(330 + Math.random() * 60, 0.22, 0.08, 'sine');
          this.tone(660, 0.14, 0.05, 'sine', 0.05);
          break;
        case 'hurt': this.burst(240, 0.12, 0.16); break;
        case 'level': this.bell(1.25); break;
        case 'bell': this.bell(0.75); break;
        case 'lash': case 'stainedlash': this.burst(2400, 0.07, 0.05); break;
        case 'post': if (!e.a) this.tone(440, 0.45, 0.08, 'sine'); else this.tone(150, 0.2, 0.08, 'triangle'); break;
        case 'crate': if (e.a) this.burst(500, 0.14, 0.12); break;
        case 'elite': this.tone(82, 0.8, 0.22, 'sawtooth'); break;
        case 'boss': this.tone(46, 1.8, 0.4, 'sawtooth'); break;
        case 'inversion': this.tone(38, 2.4, 0.5, 'sine'); break;
        case 'sweep': this.burst(180, 0.45, 0.3); break;
        case 'gutter': this.tone(120, 0.5, 0.2, 'triangle'); break;
        case 'dawn': this.bell(1); this.bell(1.5); this.bell(2); break;
        default: break;
      }
    }
  }
}
