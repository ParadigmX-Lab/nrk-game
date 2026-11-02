import { CFG } from './config.js';
import { bearingDeg, bearingName, fmtTime } from './util.js';
import { drawMinimap } from './tacmap.js';

const C_BIG = 2 * Math.PI * 41;
const C_SMALL = 2 * Math.PI * 30;

// Оновлює DOM лише коли значення змінилося, щоб не смикати верстку кожен кадр
export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      battFill: $('battFill'),
      battTxt: $('battTxt'),
      bars: Array.from($('bars').children),
      sigTxt: $('sigTxt'),
      cargoTxt: $('cargoTxt'),
      pips: Array.from($('pips').children),
      progLbl: $('progLbl'),
      progVal: $('progVal'),
      progFill: $('progFill'),
      expFill: $('expFill'),
      det: $('det'),
      detLbl: $('detLbl'),
      detVal: $('detVal'),
      wedge: $('wedge'),
      banner: $('banner'),
      toasts: $('toasts'),
      clock: $('clock'),
      btnDash: $('btnDash'),
      btnReb: $('btnReb'),
      btnScan: $('btnScan'),
      ringDash: $('ringDash'),
      ringReb: $('ringReb'),
      ringScan: $('ringScan'),
      lblDash: $('lblDash'),
      lblReb: $('lblReb'),
      lblScan: $('lblScan'),
      hitflash: $('hitflash'),
      fps: $('fps'),
      controls: $('controls'),
      minimap: $('minimap'),
      mtag: $('mtag'),
      mini: $('miniCanvas'),
    };
    this.miniCtx = this.el.mini.getContext('2d');
    this.miniT = 0;
    this.cache = {};
    this.el.ringDash.style.strokeDasharray = C_BIG;
    this.el.ringReb.style.strokeDasharray = C_SMALL;
    this.el.ringScan.style.strokeDasharray = C_SMALL;
    this.fpsAcc = 0;
    this.fpsN = 0;
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  toast(text, kind = 'info') {
    const box = this.el.toasts;
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3100);
  }

  clearToasts() {
    this.el.toasts.innerHTML = '';
  }

  update(g, dt) {
    if (!g.robot) return;
    const r = g.robot;
    const el = this.el;

    // Заряд
    // Пробита батарея тече - показуємо стрілкою, щоб було зрозуміло, куди зникає заряд
    const b = Math.max(0, Math.round(r.battery));
    const leak = r.dmg.battery;
    this.set('batt', `${b}:${leak}`, () => {
      el.battTxt.textContent = leak ? `${b}% ↓` : `${b}%`;
      el.battFill.setAttribute('width', String(Math.max(0.5, (15 * b) / 100)));
      el.battFill.setAttribute('fill', b <= 15 ? '#FF5A4E' : b <= 30 || leak ? '#FFC845' : '#8BF28A');
      el.battTxt.style.color = b <= 15 ? '#FF8A80' : leak ? '#FFC845' : '';
    });

    // Сигнал
    this.set('bars', g.signal.bars, (v) => {
      el.bars.forEach((i, k) => {
        i.style.background = k < v ? (v <= 2 ? '#FF5A4E' : '#8BF28A') : 'rgba(255,255,255,0.22)';
      });
      el.sigTxt.textContent = `${v}/5`;
      el.sigTxt.style.color = v <= 2 ? '#FF8A80' : '';
    });

    this.set('cargo', r.cargo, (v) => {
      el.cargoTxt.textContent = `${v} кг`;
    });

    this.set('integ', r.integrity, (v) => {
      el.pips.forEach((p, k) => p.classList.toggle('lost', k >= v));
    });

    // Прогрес маршруту
    const ph = g.phase;
    const op = g.map.ops[g.task.op];
    let lbl;
    let val;
    let pct;
    if (ph === 'loading') {
      lbl = 'ЗАВАНТАЖЕННЯ';
      val = `${Math.round(r.cargo / 10)}/4`;
      pct = (r.cargo / CFG.robot.cargoKg) * 100;
    } else if (ph === 'unloading') {
      const done = Math.round(g.delivered / 10);
      lbl = 'РОЗВАНТАЖЕННЯ';
      val = `${done}/${g.unloadTotal}`;
      pct = g.unloadTotal ? (done / g.unloadTotal) * 100 : 100;
    } else if (ph === 'parking') {
      lbl = 'ЗАЇЗД НА БАЗУ';
      val = '';
      pct = 100;
    } else {
      // На вузькому екрані «ДО» не влазить поруч із метрами - назва ОП важливіша
      lbl = ph === 'return' ? 'ДО БАЗИ' : window.innerWidth < 800 ? `«${op.name}»` : `ДО ОП «${op.name}»`;
      val = `${g.remainingM} м`;
      pct = g.progress * 100;
    }
    this.set('progLbl', lbl, (v) => (el.progLbl.textContent = v));
    this.set('progVal', val, (v) => (el.progVal.textContent = v));
    this.set('progFill', Math.round(pct), (v) => (el.progFill.style.width = `${v}%`));
    this.set('exp', Math.round(g.fpv.exposure), (v) => {
      el.expFill.style.width = `${v}%`;
      el.expFill.style.background = v > 70 ? '#FF5A4E' : v > 40 ? '#FFC845' : '#8BF28A';
    });

    // Детектор
    const det = g.det;
    if (det.count > 0) {
      const f = det.f;
      const brg = bearingDeg(f.x - r.x, f.y - r.y);
      const name = bearingName(brg);
      const kind = det.fiber ? 'fiber' : det.bomber ? 'bomber' : 'radio';
      this.set('detKind', kind, (v) => {
        el.det.classList.remove('idle', 'radio', 'fiber', 'bomber');
        el.det.classList.add(v);
        el.detLbl.textContent = v === 'fiber' ? 'АКУСТИКА' : 'ДЕТЕКТОР';
      });
      const txt = `${det.fiber ? 'ОПТ' : det.bomber ? 'БПЛА' : 'FPV'}${det.count > 1 ? ' ×' + det.count : ''} · ${name}`;
      this.set('detVal', txt, (v) => (el.detVal.textContent = v));
      this.set('wedge', Math.round(brg), (v) => el.wedge.setAttribute('transform', `rotate(${v} 16 16)`));
    } else {
      this.set('detKind', 'idle', (v) => {
        el.det.classList.remove('radio', 'fiber', 'bomber');
        el.det.classList.add(v);
        el.detLbl.textContent = 'ДЕТЕКТОР';
      });
      this.set('detVal', 'ЧИСТО', (v) => (el.detVal.textContent = v));
    }

    // Банер посередині
    let banner = '';
    let bannerKind = '';
    if (ph === 'loading') {
      banner = 'ЗАВАНТАЖЕННЯ БК · ТОРКНИСЬ, ЩОБ ПРОПУСТИТИ';
      bannerKind = 'info';
    } else if (ph === 'unloading') {
      banner = 'РОЗВАНТАЖЕННЯ · ПІХОТА ПРИКРИВАЄ';
      bannerKind = 'good';
    } else if (ph === 'parking') {
      banner = 'ЗАЇЗД НА БАЗУ';
      bannerKind = 'good';
    } else if (g.task.next !== null) {
      banner = 'ШТАБ: ЗМІНА ЗАВДАННЯ · ВІДКРИЙ КАРТУ';
      bannerKind = 'warn';
    } else if (r.tangle > 0) {
      banner = 'ЗАПЛУТАВСЯ В СІТЦІ · РИВОК, ЩОБ ВИРВАТИСЯ';
      bannerKind = 'warn';
    } else if (g.signal.bars <= 2) {
      banner = `СЛАБКИЙ СИГНАЛ · ЗАТРИМКА ${g.signal.delay.toFixed(1)} с`;
      bannerKind = 'bad';
    } else if (r.battery <= 12 && !g.result) {
      banner = 'НИЗЬКИЙ ЗАРЯД';
      bannerKind = 'bad';
    }
    this.set('banner', banner + bannerKind, () => {
      el.banner.textContent = banner;
      el.banner.className = banner ? `show ${bannerKind}` : '';
    });

    this.set('clock', Math.floor(g.elapsed), () => (el.clock.textContent = fmtTime(g.elapsed)));

    // Кнопки й кільця перезарядки
    // Ключ кешу містить стан «гріється/готово», інакше останній кадр перезарядки
    // мав той самий ключ, що й готова кнопка, і кнопка лишалась сірою
    const dashP = 1 - r.dash.cd / CFG.dash.cooldown;
    this.set('dashP', `${r.dash.cd > 0}:${Math.ceil(r.dash.cd)}:${Math.round(dashP * 50)}`, () => {
      el.ringDash.style.strokeDashoffset = C_BIG * (1 - dashP);
      el.btnDash.classList.toggle('cooling', r.dash.cd > 0);
      el.lblDash.textContent = r.dash.cd > 0 ? `${Math.ceil(r.dash.cd)} с` : 'РИВОК';
    });
    const scanP = 1 - r.scan.cd / CFG.scan.cooldown;
    this.set('scanP', `${r.scan.cd > 0}:${Math.ceil(r.scan.cd)}:${Math.round(scanP * 50)}`, () => {
      el.ringScan.style.strokeDashoffset = C_SMALL * (1 - scanP);
      el.btnScan.classList.toggle('cooling', r.scan.cd > 0);
      el.lblScan.textContent = r.scan.cd > 0 ? `${Math.ceil(r.scan.cd)} с` : 'СКАН';
    });
    let rebState;
    let rebP;
    if (r.reb.on) {
      rebState = 'on';
      rebP = 1 - r.reb.heat / CFG.reb.maxOn;
    } else if (r.reb.cd > 0) {
      rebState = 'cd';
      rebP = 1 - r.reb.cd / CFG.reb.overheatCd;
    } else {
      rebState = 'ready';
      rebP = 1 - r.reb.heat / CFG.reb.maxOn;
    }
    this.set('reb', `${rebState}:${Math.ceil(r.reb.cd)}:${Math.round(rebP * 50)}`, () => {
      el.ringReb.style.strokeDashoffset = C_SMALL * (1 - rebP);
      el.btnReb.classList.toggle('on', rebState === 'on');
      el.btnReb.classList.toggle('cooling', rebState === 'cd');
      el.ringReb.style.stroke = rebState === 'on' ? '#78DCFF' : rebState === 'cd' ? '#FF5A4E' : '#8BF28A';
      el.lblReb.textContent = rebState === 'cd' ? `${Math.ceil(r.reb.cd)} с` : rebState === 'on' ? 'РЕБ ●' : 'РЕБ';
    });

    this.set('locked', g.locked, (v) => el.controls.classList.toggle('locked', v));
    this.set('alert', g.task.next !== null, (v) => {
      el.minimap.classList.toggle('alert', v);
      el.mtag.textContent = v ? 'НОВЕ ЗАВДАННЯ' : 'КАРТА';
    });

    // Мінікарта оновлюється 5 разів на секунду - цього досить
    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 0.2;
      const c = el.mini;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (w > 0 && h > 0) {
        if (c.width !== Math.round(w * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        this.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMinimap(this.miniCtx, g, w, h);
      }
    }

    // Спалах при влучанні
    this.set('flash', Math.round(g.flash * 20), (v) => (el.hitflash.style.opacity = String(v / 20)));

    if (el.fps && !el.fps.hidden) {
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc >= 0.5) {
        el.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS`;
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
    }
  }

  reset() {
    this.cache = {};
    this.miniT = 0;
    this.clearToasts();
    // Скільки влучань витримає НРК - залежить від складності
    const box = document.getElementById('pips');
    if (box.children.length !== CFG.integrity) {
      box.innerHTML = '';
      for (let i = 0; i < CFG.integrity; i++) box.appendChild(document.createElement('i'));
    }
    this.el.pips = Array.from(box.children);
  }
}
