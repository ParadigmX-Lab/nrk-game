// Усі звуки синтезуються на льоту через WebAudio: жодних файлів, працює офлайн.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('nrk.muted') === '1';
    } catch (e) {
      /* приватний режим */
    }
    this.hum = null;
  }

  init() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // iOS після дзвінка чи згортання ставить стан 'interrupted', не лише 'suspended'
  resume() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      try {
        this.ctx.resume();
      } catch (e) {
        /* повторимо на наступному натисканні */
      }
    }
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('nrk.muted', m ? '1' : '0');
    } catch (e) {
      /* ігноруємо */
    }
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  tone(freq, dur, type = 'square', vol = 0.2, slideTo = 0, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, vol, freq, type = 'lowpass', q = 0.7, freqTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  beep(kind) {
    if (kind === 'fiber') this.tone(820, 0.06, 'triangle', 0.16);
    else if (kind === 'bomber') this.tone(1250, 0.07, 'sawtooth', 0.07);
    else this.tone(1760, 0.045, 'square', 0.09);
  }

  explosion(big, vol = 1) {
    this.noise(big ? 1.3 : 0.9, (big ? 0.95 : 0.75) * vol, big ? 700 : 1000, 'lowpass', 0.8, 120);
    this.tone(70, 0.6, 'sine', 0.7 * vol, 28);
  }

  // Свист міни, що летить: тон падає до моменту прильоту
  whistle(dur) {
    this.tone(1900, dur, 'sine', 0.12, 520);
  }

  dropFall() {
    this.tone(2400, 0.9, 'sine', 0.05, 900);
  }

  horn() {
    this.tone(330, 0.22, 'square', 0.08);
    this.tone(415, 0.22, 'square', 0.06);
    this.tone(330, 0.3, 'square', 0.08, 0, 0.3);
    this.tone(415, 0.3, 'square', 0.06, 0, 0.3);
  }

  // Рація: короткий шум і два сигнали
  radio() {
    this.noise(0.18, 0.25, 2500, 'bandpass', 2);
    this.tone(1200, 0.08, 'square', 0.08, 0, 0.2);
    this.tone(1500, 0.12, 'square', 0.08, 0, 0.32);
  }

  tangle() {
    this.noise(0.5, 0.35, 1800, 'bandpass', 3, 600);
  }

  dive() {
    this.tone(1300, 0.9, 'sawtooth', 0.05, 520);
  }

  dash() {
    this.noise(0.35, 0.35, 500, 'bandpass', 1.2, 2400);
  }

  scan() {
    this.tone(500, 0.45, 'sine', 0.25, 1600);
    this.tone(1600, 0.25, 'sine', 0.1, 1600, 0.45);
  }

  click() {
    this.tone(900, 0.04, 'square', 0.06);
  }

  deny() {
    this.tone(220, 0.15, 'square', 0.1, 160);
  }

  chime() {
    this.tone(660, 0.18, 'triangle', 0.22);
    this.tone(880, 0.18, 'triangle', 0.22, 0, 0.14);
    this.tone(1320, 0.35, 'triangle', 0.22, 0, 0.28);
  }

  fail() {
    this.tone(330, 0.35, 'sawtooth', 0.15, 220);
    this.tone(220, 0.6, 'sawtooth', 0.15, 110, 0.3);
  }

  jam() {
    this.noise(0.5, 0.3, 3000, 'highpass', 0.5);
  }

  rebOn() {
    if (!this.ctx || this.hum) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 96;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = this.ctx.createGain();
    lg.gain.value = 18;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.1);
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    lfo.start(t);
    this.hum = { o, lfo, g };
  }

  rebOff() {
    if (!this.hum || !this.ctx) return;
    const t = this.ctx.currentTime;
    const h = this.hum;
    h.g.gain.cancelScheduledValues(t);
    h.g.gain.setValueAtTime(h.g.gain.value, t);
    h.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    h.o.stop(t + 0.15);
    h.lfo.stop(t + 0.15);
    this.hum = null;
  }
}
