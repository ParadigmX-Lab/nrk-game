// Плаваючий джойстик (ліва частина екрана), кнопки дій і клавіатура для ПК.
const R = 52; // радіус ходу джойстика, css px

export class Input {
  constructor(els) {
    this.els = els;
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, mag: 0 };
    this.keys = new Set();
    this.actions = [];
    this.enabled = false;

    const t = els.touch;
    t.addEventListener('pointerdown', (e) => this.onDown(e));
    t.addEventListener('pointermove', (e) => this.onMove(e));
    t.addEventListener('pointerup', (e) => this.onUp(e));
    t.addEventListener('pointercancel', (e) => this.onUp(e));

    const bind = (btn, name) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.enabled) this.actions.push(name);
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bind(els.btnDash, 'dash');
    bind(els.btnReb, 'reb');
    bind(els.btnScan, 'scan');

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (!this.enabled) return;
      if (k === ' ') this.actions.push('dash');
      else if (k === 'e' || k === 'у') this.actions.push('reb');
      else if (k === 'q' || k === 'й') this.actions.push('scan');
      else if (k === 'escape' || k === 'p' || k === 'з') this.actions.push('pause');
      else if (k === 'm' || k === 'ь') this.actions.push('map');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });

    this.placeIdle();
    window.addEventListener('resize', () => this.placeIdle());
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.release();
    this.actions.length = 0;
  }

  onDown(e) {
    if (this.enabled) this.actions.push('tap');
    if (!this.enabled || this.joy.id !== null) return;
    const rect = this.els.touch.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width * 0.6) return;
    e.preventDefault();
    this.joy.id = e.pointerId;
    this.joy.ox = e.clientX;
    this.joy.oy = e.clientY;
    this.joy.x = 0;
    this.joy.y = 0;
    this.joy.mag = 0;
    try {
      this.els.touch.setPointerCapture(e.pointerId);
    } catch (err) {
      /* старі браузери */
    }
    this.els.joy.classList.add('active');
    this.drawJoy();
  }

  onMove(e) {
    if (e.pointerId !== this.joy.id) return;
    e.preventDefault();
    let dx = e.clientX - this.joy.ox;
    let dy = e.clientY - this.joy.oy;
    const d = Math.hypot(dx, dy);
    // Якщо палець пішов далеко - джойстик «їде» за пальцем
    if (d > R * 1.6) {
      const k = (d - R * 1.6) / d;
      this.joy.ox += dx * k;
      this.joy.oy += dy * k;
      dx = e.clientX - this.joy.ox;
      dy = e.clientY - this.joy.oy;
    }
    const dd = Math.hypot(dx, dy);
    const m = Math.min(1, dd / R);
    this.joy.mag = m < 0.12 ? 0 : m;
    this.joy.x = dd > 0 ? dx / dd : 0;
    this.joy.y = dd > 0 ? dy / dd : 0;
    this.drawJoy();
  }

  onUp(e) {
    if (e.pointerId !== this.joy.id) return;
    this.release();
  }

  release() {
    this.joy.id = null;
    this.joy.mag = 0;
    this.joy.x = 0;
    this.joy.y = 0;
    this.els.joy.classList.remove('active');
    this.placeIdle();
  }

  placeIdle() {
    if (this.joy.id !== null) return;
    const rect = this.els.touch.getBoundingClientRect();
    this.joy.ox = rect.left + Math.max(96, rect.width * 0.11);
    this.joy.oy = rect.top + rect.height - 92;
    this.drawJoy();
  }

  drawJoy() {
    const rect = this.els.touch.getBoundingClientRect();
    const bx = this.joy.ox - rect.left;
    const by = this.joy.oy - rect.top;
    this.els.joy.style.transform = `translate(${bx - R}px, ${by - R}px)`;
    const kx = this.joy.x * this.joy.mag * R;
    const ky = this.joy.y * this.joy.mag * R;
    this.els.knob.style.transform = `translate(${kx}px, ${ky}px)`;
  }

  command() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('arrowleft') || k.has('a') || k.has('ф')) x -= 1;
    if (k.has('arrowright') || k.has('d') || k.has('в')) x += 1;
    if (k.has('arrowup') || k.has('w') || k.has('ц')) y -= 1;
    if (k.has('arrowdown') || k.has('s') || k.has('і') || k.has('ы')) y += 1;
    if (x || y) {
      const d = Math.hypot(x, y);
      return { x: x / d, y: y / d, mag: 1 };
    }
    return { x: this.joy.x, y: this.joy.y, mag: this.joy.mag };
  }

  takeActions() {
    const a = this.actions.slice();
    this.actions.length = 0;
    return a;
  }
}
