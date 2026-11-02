import { CFG } from './config.js';
import { generateMap, nearestRoad, netAt, dangerAt, inWater, onBridge, treesNear } from './map.js';
import { planRoute } from './nav.js';
import { FpvManager } from './threats.js';
import { Traffic } from './traffic.js';
import { Effects } from './effects.js';
import { Crew } from './crew.js';
import { clamp, dist, wrapAngle, inRotRect, vibrate } from './util.js';
import { hashString } from './rng.js';

const CRATE_KG = 10;

function createRobot(map) {
  return {
    x: map.garage.park.x,
    y: map.garage.park.y,
    a: 0,
    speed: 0,
    vx: 0,
    vy: 0,
    integrity: CFG.integrity,
    battery: 100,
    cargo: 0,
    dmg: { tracks: false, camera: false, battery: false },
    drift: 0,
    trackPhase: 0,
    dash: { t: 0, cd: 0, dx: 0, dy: 0 },
    reb: { on: false, heat: 0, cd: 0 },
    scan: { cd: 0 },
    tangle: 0,
    tangleCd: 0,
    alive: true,
    powered: true,
    moving: false,
  };
}

// Виштовхує коло радіуса rr з повернутого прямокутника. true - якщо було зіткнення.
function pushOutRect(r, rect, rr) {
  const dx = r.x - rect.x;
  const dy = r.y - rect.y;
  const c = Math.cos(-rect.a);
  const s = Math.sin(-rect.a);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  const qx = clamp(lx, -hw, hw);
  const qy = clamp(ly, -hh, hh);
  const ox = lx - qx;
  const oy = ly - qy;
  const d = Math.hypot(ox, oy);
  if (d >= rr) return false;
  let nx;
  let ny;
  let push;
  if (d > 0.001) {
    nx = ox / d;
    ny = oy / d;
    push = rr - d;
  } else {
    const px = hw - Math.abs(lx);
    const py = hh - Math.abs(ly);
    if (px < py) {
      nx = Math.sign(lx) || 1;
      ny = 0;
      push = px + rr;
    } else {
      nx = 0;
      ny = Math.sign(ly) || 1;
      push = py + rr;
    }
  }
  const c2 = Math.cos(rect.a);
  const s2 = Math.sin(rect.a);
  r.x += (nx * c2 - ny * s2) * push;
  r.y += (nx * s2 + ny * c2) * push;
  return true;
}

// Фази рейсу: loading (катсцена на базі) → outbound → unloading (катсцена на ОП) → return → parking (заїзд у гараж)
export class Game {
  constructor({ sfx, onToast, onEnd }) {
    this.sfx = sfx;
    this.onToast = onToast;
    this.onEnd = onEnd;
    this.state = 'menu';
    this.map = null;
  }

  load(seed, label) {
    this.seed = seed;
    this.label = label;
    this.reset();
  }

  reset() {
    this.map = generateMap(this.seed);
    const sc = this.map.scenario;
    this.robot = createRobot(this.map);
    this.fpv = new FpvManager(this);
    this.traffic = new Traffic(this);
    this.fx = new Effects();
    this.crew = new Crew();
    this.tracers = [];
    this.trail = [];
    this.phase = 'loading';
    this.locked = true;
    this.elapsed = 0;
    this.hits = 0;
    this.cargoLost = 0;
    this.delivered = 0;
    this.unloadTotal = 0;
    this.unloadOp = undefined;
    this.cmdHist = [];
    this.posHist = [];
    this.posT = 0;
    this.signal = { bars: 5, delay: 0 };
    this.inCover = true;
    this.underNet = false;
    this.curNet = null;
    this.offroad = false;
    this.loitering = false;
    this.danger = 0;
    this.shake = 0;
    this.flash = 0;
    this.result = null;
    this.endTimer = 0;
    this.flags = {};
    this.msgT = {};
    this.beepT = 0;
    this.det = { count: 0 };
    this.route = null;
    this.routeTimer = 0;
    this.routeLen0 = 0;
    this.outLen0 = 0;
    this.remainPx = 0;
    this.remainingM = 0;
    this.progress = 0;
    this.dustT = 0;
    this.lastTrail = null;
    this.gateTarget = 0;
    this.parkStage = 0;
    this.map.garage.gate = 0;
    this.stackLeft = 4;
    // op - ціль, яку бачить оператор; next - нова ціль від штабу, поки її не підтвердили на карті
    // Ціль - від сиду (у всіх однакова), а чи зміниться вона - кидаємо заново в кожному рейсі
    const willChange = Math.random() < CFG.task.chance;
    const at = CFG.task.from + (CFG.task.to - CFG.task.from) * Math.random();
    this.task = { op: sc.first, next: null, acked: true, changed: false, old: null, willChange, at, nextOp: sc.next };
    this.setupCrew();
    this.updateNav(0, true);
    this.updateCover();
    // Ждуни - від сиду карти й рівня складності
    this.fpv.setupAmbush(hashString(`${this.seed}:${CFG.level ? CFG.level.id : ''}`));
  }

  setupCrew() {
    const m = this.map;
    const g = m.garage;
    this.crew.add(g.rest[0].x, g.rest[0].y, Math.PI / 2, { tag: 'base' });
    this.crew.add(g.rest[1].x, g.rest[1].y, -Math.PI / 2, { tag: 'base' });
    for (const op of m.ops) for (const p of op.posts) this.crew.add(p.x, p.y, op.a, { tag: 'post' });
    const op0 = m.ops[this.task.op];
    this.crew.add(op0.exit.x, op0.exit.y, op0.a, { tag: 'porter', visible: false });
    this.crew.add(op0.exit.x, op0.exit.y, op0.a, { tag: 'porter', visible: false });
  }

  start() {
    this.reset();
    this.state = 'play';
    this.beginLoading();
  }

  toast(text, kind) {
    if (this.onToast) this.onToast(text, kind);
  }

  // Повідомлення не частіше, ніж раз на cd секунд
  say(id, cd, text, kind) {
    if (this.msgT[id] !== undefined && this.elapsed - this.msgT[id] < cd) return;
    this.msgT[id] = this.elapsed;
    this.toast(text, kind);
  }

  addCrater(x, y, r) {
    this.map.craters.push({ x, y, r, water: false, scorch: true });
  }

  addTracers(fromList, tx, ty) {
    for (const p of fromList) {
      for (let k = 0; k < 3; k++) {
        this.tracers.push({ x0: p.x, y0: p.y, x1: tx + (Math.random() - 0.5) * 14, y1: ty + (Math.random() - 0.5) * 14, t: -k * 0.08, dur: 0.22 });
      }
    }
  }

  // Дірка в сітці + провис, у якому можна заплутатися
  tearNet(net, x, y) {
    if (!net.holes.some((h) => dist(h.x, h.y, x, y) < 22)) {
      net.holes.push({ x, y, r: 13 + Math.random() * 5, a: Math.random() * Math.PI });
    }
    if (!net.sags.some((s) => dist(s.x, s.y, x, y) < 26)) {
      net.sags.push({ x, y, r: 15 + Math.random() * 4, a: Math.random() * Math.PI, torn: true });
    }
  }

  netAt(x, y) {
    return netAt(this.map, x, y);
  }

  // Справжня ціль (куди реально треба везти) і ціль, яку показує навігація
  realOp() {
    return this.task.next !== null ? this.task.next : this.task.op;
  }

  navNode() {
    if (this.phase === 'return' || this.phase === 'parking') return this.map.base.node;
    return this.map.ops[this.task.op].node;
  }

  // Викликається, коли оператор відкрив карту
  ackTask() {
    const t = this.task;
    if (t.next === null) return false;
    t.old = t.op;
    t.op = t.next;
    t.next = null;
    t.acked = true;
    this.routeTimer = 0;
    this.routeLen0 = 0;
    this.updateNav(0, true);
    this.toast(`Маршрут оновлено: ОП «${this.map.ops[t.op].name}»`, 'good');
    return true;
  }

  triggerTaskChange() {
    const t = this.task;
    t.changed = true;
    t.next = t.nextOp;
    t.acked = false;
    t.old = t.op;
    this.map.ops[t.op].status = 'fire';
    this.msgT.task = this.elapsed;
    this.sfx.radio();
    vibrate([40, 60, 40]);
    this.toast('Штаб: ЗМІНА ЗАВДАННЯ! Відкрий карту', 'warn');
  }

  // ---------- Катсцени ----------
  beginLoading() {
    const r = this.robot;
    const g = this.map.garage;
    const [a, b] = this.crew.byTag('base');
    const sides = [
      [r.x - 6, r.y - 34],
      [r.x - 6, r.y + 34],
    ];
    const order = [[0, 2], [1, 3]];
    [a, b].forEach((s, i) => {
      s.queue.push({ wait: i * 0.5 });
      for (const ci of order[i]) {
        const c = g.stack[ci];
        s.queue.push({ go: [c.x, c.y + (i ? 14 : -14)] });
        s.queue.push({
          call: (sol) => {
            sol.carry = true;
            c.taken = true;
            this.stackLeft--;
          },
        });
        s.queue.push({ go: sides[i] });
        s.queue.push({
          call: (sol) => {
            sol.carry = false;
            r.cargo = Math.min(CFG.robot.cargoKg, r.cargo + CRATE_KG);
          },
        });
      }
      s.queue.push({ go: [g.rest[i].x, g.rest[i].y] });
      s.queue.push({ face: i ? -Math.PI / 2 : Math.PI / 2 });
    });
    this.toast('Завантаження БК. Торкнись екрана, щоб пропустити', 'info');
  }

  skipLoading() {
    const r = this.robot;
    const g = this.map.garage;
    r.cargo = CFG.robot.cargoKg;
    this.stackLeft = 0;
    for (const c of g.stack) c.taken = true;
    this.crew.byTag('base').forEach((s, i) => {
      s.queue.length = 0;
      s.carry = false;
      s.x = g.rest[i].x;
      s.y = g.rest[i].y;
      s.a = i ? -Math.PI / 2 : Math.PI / 2;
    });
    this.gateTarget = 1;
    g.gate = 1;
  }

  beginOutbound() {
    this.phase = 'outbound';
    this.locked = false;
    this.posHist.length = 0;
    this.routeLen0 = 0;
    this.updateNav(0, true);
    this.outLen0 = this.remainPx;
    this.toast(`Ціль: ОП «${this.map.ops[this.task.op].name}». Маршрут - на мінікарті`, 'info');
    setTimeout(() => {
      if (this.state === 'play' && this.phase === 'outbound' && this.elapsed < 9) this.toast('Тримайся дороги - поля заміновані. Мінікарта справа вгорі', 'info');
    }, 3000);
  }

  beginUnloading(op) {
    const r = this.robot;
    this.phase = 'unloading';
    this.locked = true;
    this.unloadOp = op.idx;
    if (r.reb.on) {
      r.reb.on = false;
      this.sfx.rebOff();
    }
    r.tangle = 0;
    const crates = Math.ceil(r.cargo / CRATE_KG);
    this.unloadTotal = crates;
    if (crates === 0) {
      this.toast('Вантажу не лишилось. Повертайся на базу', 'warn');
      this.beginReturn();
      return;
    }
    this.toast(`ОП «${op.name}»: НРК в укритті, піхота розвантажує`, 'good');
    const nx = -Math.sin(op.a);
    const ny = Math.cos(op.a);
    const porters = this.crew.byTag('porter');
    porters.forEach((s, i) => {
      s.visible = true;
      s.x = op.exit.x;
      s.y = op.exit.y;
      s.queue.length = 0;
      s.queue.push({ wait: i * 0.9 });
    });
    for (let k = 0; k < crates; k++) {
      const s = porters[k % 2];
      const along = k % 2 ? -8 : 8;
      const side = [r.x - nx * 32 + Math.cos(op.a) * along, r.y - ny * 32 + Math.sin(op.a) * along];
      s.queue.push({ go: side });
      s.queue.push({
        call: (sol) => {
          if (r.cargo <= 0) return;
          const kg = Math.min(CRATE_KG, r.cargo);
          r.cargo -= kg;
          this.delivered += kg;
          sol.carry = true;
        },
      });
      s.queue.push({ go: [op.exit.x, op.exit.y] });
      s.queue.push({ go: [op.dugEntry.x, op.dugEntry.y] });
      s.queue.push({
        call: (sol) => {
          sol.carry = false;
        },
      });
      s.queue.push({ go: [op.exit.x, op.exit.y] });
    }
    porters.forEach((s) =>
      s.queue.push({
        call: (sol) => {
          sol.visible = false;
        },
      }),
    );
  }

  beginReturn() {
    this.phase = 'return';
    this.locked = false;
    this.posHist.length = 0;
    this.routeLen0 = 0;
    this.updateNav(0, true);
    if (this.delivered > 0) {
      this.sfx.chime();
      vibrate(60);
      this.toast(`Вантаж передано: ${this.delivered} кг. Повертайся на базу`, 'good');
    }
  }

  beginParking() {
    this.phase = 'parking';
    this.locked = true;
    this.parkStage = 0;
    this.parkT = 0;
    const r = this.robot;
    r.tangle = 0;
    if (r.reb.on) {
      r.reb.on = false;
      this.sfx.rebOff();
    }
    const g = this.map.garage;
    this.crew.byTag('base').forEach((s, i) => {
      s.queue.length = 0;
      s.queue.push({ wait: 0.6 + i * 0.3 });
      s.queue.push({ go: [g.park.x - 4, g.park.y + (i ? 36 : -36)] });
      s.queue.push({ face: i ? -Math.PI / 2 : Math.PI / 2 });
    });
    this.toast('Заїзд на базу', 'info');
  }

  // ---------- Сигнал і затримка ----------
  updateSignal() {
    const r = this.robot;
    let bars = 5;
    for (const z of this.map.rebZones) {
      const d = dist(r.x, r.y, z.x, z.y);
      if (d < z.r) bars = Math.min(bars, Math.max(1, Math.round(1 + 4 * (d / z.r))));
    }
    if (r.reb.on) bars = Math.max(1, bars - 1);
    this.signal.bars = bars;
    this.signal.delay = (5 - bars) * CFG.signal.delayPerBar;
  }

  delayedCommand(raw) {
    this.cmdHist.push({ t: this.elapsed, x: raw.x, y: raw.y, mag: raw.mag });
    while (this.cmdHist.length && this.cmdHist[0].t < this.elapsed - 1.2) this.cmdHist.shift();
    const want = this.elapsed - this.signal.delay;
    for (let i = this.cmdHist.length - 1; i >= 0; i--) {
      if (this.cmdHist[i].t <= want) return this.cmdHist[i];
    }
    return this.cmdHist[0] || raw;
  }

  terrainFactor() {
    const r = this.robot;
    const m = this.map;
    for (const p of m.mud) {
      if (Math.abs(p.x - r.x) > p.rx || Math.abs(p.y - r.y) > p.rx) continue;
      const dx = r.x - p.x;
      const dy = r.y - p.y;
      const c = Math.cos(-p.a);
      const s = Math.sin(-p.a);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if ((lx * lx) / (p.rx * p.rx) + (ly * ly) / (p.ry * p.ry) < 1) return CFG.terrain.mud;
    }
    for (const c of m.craters) {
      if (Math.abs(c.x - r.x) < c.r && Math.abs(c.y - r.y) < c.r && dist(c.x, c.y, r.x, r.y) < c.r * 0.8) return CFG.terrain.crater;
    }
    if (this.inBaseOrOp()) return CFG.terrain.road;
    const edge = CFG.road.width / 2 + 4;
    if (this.roadDist < edge) return CFG.terrain.road;
    if (this.roadDist < edge + CFG.shoulderWidth) return CFG.terrain.shoulder;
    return CFG.terrain.field;
  }

  inBaseOrOp() {
    const r = this.robot;
    const m = this.map;
    if (inRotRect(r.x, r.y, m.garage, 30) || dist(r.x, r.y, m.base.x, m.base.y) < 60) return true;
    return m.ops.some((op) => inRotRect(r.x, r.y, op.capon, 30));
  }

  updateNav(dt, force = false) {
    const r = this.robot;
    const m = this.map;
    const nr = nearestRoad(m, r.x, r.y, 1200);
    this.roadDist = nr ? nr.d : 9999;
    this.danger = dangerAt(m, r.x);
    this.offroad = this.roadDist >= CFG.road.width / 2 + 4 + CFG.shoulderWidth && !this.inBaseOrOp();
    this.curNet = netAt(m, r.x, r.y);
    this.underNet = !!this.curNet;
    this.routeTimer -= dt;
    if (force || this.routeTimer <= 0) {
      this.routeTimer = 0.35;
      this.route = planRoute(m, r.x, r.y, this.navNode());
    }
    this.remainPx = this.route ? this.route.len + Math.min(this.roadDist, 600) : 0;
    this.remainingM = Math.max(0, Math.round((this.remainPx * CFG.metersPerPx) / 10) * 10);
    this.routeLen0 = Math.max(this.routeLen0, this.remainPx);
    this.progress = this.routeLen0 > 0 ? clamp(1 - this.remainPx / this.routeLen0, 0, 1) : 0;
  }

  updateCover() {
    const r = this.robot;
    const m = this.map;
    let cover = false;
    for (const t of treesNear(m, r.x, r.y)) {
      const lim = t.r * 0.9 + 8;
      if (Math.abs(t.x - r.x) > lim || Math.abs(t.y - r.y) > lim) continue;
      if (dist(t.x, t.y, r.x, r.y) < lim) {
        cover = true;
        break;
      }
    }
    if (!cover) {
      for (const ru of m.ruins) {
        if (Math.abs(ru.x - r.x) > 80 || Math.abs(ru.y - r.y) > 80) continue;
        if (inRotRect(r.x, r.y, ru, -6)) {
          cover = true;
          break;
        }
      }
    }
    if (!cover && inRotRect(r.x, r.y, m.garage, -8)) cover = true;
    if (!cover && m.ops.some((op) => inRotRect(r.x, r.y, op.net, -10))) cover = true;
    this.inCover = cover;
  }

  // ---------- Дії гравця ----------
  doAction(name, raw) {
    const r = this.robot;
    if (name === 'tap' || name === 'skip') {
      if (this.phase === 'loading') this.skipLoading();
      return;
    }
    if (this.locked) {
      if (name === 'dash' && this.phase === 'loading') this.skipLoading();
      return;
    }
    if (!r.alive || !r.powered) return;
    if (name === 'dash') {
      if (r.dash.cd > 0) {
        this.sfx.deny();
        return;
      }
      let dx = Math.cos(r.a);
      let dy = Math.sin(r.a);
      if (raw.mag > 0.2) {
        dx = raw.x;
        dy = raw.y;
      }
      r.dash.t = CFG.dash.time;
      r.dash.cd = CFG.dash.cooldown;
      r.dash.dx = dx;
      r.dash.dy = dy;
      r.battery -= CFG.dash.cost;
      if (r.tangle > 0) {
        r.tangle = Math.max(0, r.tangle - CFG.tangle.dashCut);
        this.toast(r.tangle > 0 ? 'Рвеш сітку...' : 'Вирвався з сітки!', 'good');
      }
      this.sfx.dash();
      for (let i = 0; i < 6; i++) this.fx.dust(r.x, r.y, Math.atan2(dy, dx));
      vibrate(20);
    } else if (name === 'reb') {
      if (r.reb.cd > 0) {
        this.sfx.deny();
        this.toast('РЕБ охолоджується', 'warn');
        return;
      }
      r.reb.on = !r.reb.on;
      if (r.reb.on) {
        this.sfx.rebOn();
        this.fx.ring(r.x, r.y, 20, CFG.reb.radius, 0.5, 'rgba(120,220,255,0.9)', 3);
      } else this.sfx.rebOff();
    } else if (name === 'scan') {
      if (r.scan.cd > 0) {
        this.sfx.deny();
        return;
      }
      r.scan.cd = CFG.scan.cooldown;
      r.battery -= CFG.scan.cost;
      this.sfx.scan();
      this.fx.ring(r.x, r.y, 10, CFG.scan.radius, 0.7, 'rgba(255,210,74,0.95)', 3);
      let found = 0;
      for (const m of this.map.mines) {
        if (!m.alive || m.known) continue;
        if (Math.abs(m.x - r.x) > CFG.scan.radius || Math.abs(m.y - r.y) > CFG.scan.radius) continue;
        if (dist(m.x, m.y, r.x, r.y) < CFG.scan.radius) {
          m.known = true;
          m.revealT = 0;
          found++;
        }
      }
      const amb = this.fpv.reveal(r.x, r.y, CFG.scan.radius);
      if (amb) this.toast(found ? `Скан: мін - ${found}, ждунів - ${amb}!` : amb > 1 ? `Скан: поруч ждунів - ${amb}!` : 'Скан: поруч ждун! РЕБ, РИВОК або об\'їзд', 'bad');
      else this.toast(found ? `Скан: виявлено мін - ${found}` : 'Скан: нових мін не виявлено', found ? 'warn' : 'info');
    }
  }

  hitRobot(kind) {
    const r = this.robot;
    if (!r.alive) return;
    this.hits++;
    const dmg = kind === 'mine' ? 2 : 1;
    r.integrity = Math.max(0, r.integrity - dmg);
    this.shake = Math.max(this.shake, kind === 'mine' || kind === 'shell' ? 14 : 10);
    this.flash = 1;
    vibrate(kind === 'mine' ? [80, 40, 160] : 140);

    let what;
    if (kind === 'mine') {
      r.dmg.tracks = true;
      r.drift = Math.random() < 0.5 ? -1 : 1;
      what = 'ходову частину';
    } else {
      const opts = [];
      if (!r.dmg.tracks) opts.push('tracks');
      if (!r.dmg.camera) opts.push('camera');
      if (!r.dmg.battery) opts.push('battery');
      if (r.cargo > 0) opts.push('cargo', 'cargo');
      const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : 'none';
      if (pick === 'tracks') {
        r.dmg.tracks = true;
        r.drift = Math.random() < 0.5 ? -1 : 1;
        what = 'ходову частину';
      } else if (pick === 'camera') {
        r.dmg.camera = true;
        what = 'камеру';
      } else if (pick === 'battery') {
        r.dmg.battery = true;
        what = 'батарею - витік заряду';
      } else if (pick === 'cargo') {
        const lost = Math.min(CRATE_KG, r.cargo);
        r.cargo -= lost;
        this.cargoLost += lost;
        what = `вантаж: -${lost} кг`;
      } else what = 'корпус';
    }

    if (r.integrity <= 0) {
      r.alive = false;
      r.reb.on = false;
      this.sfx.rebOff();
      this.fx.explosion(r.x, r.y, true);
      this.sfx.explosion(true);
      this.toast('НРК знищено', 'bad');
      this.finish('destroyed');
      return;
    }
    const head = { mine: 'Підрив на міні!', fpv: 'Влучання FPV!', drop: 'Скид влучив!', shell: 'Приліт!' }[kind] || 'Влучання!';
    this.toast(`${head} Пошкоджено ${what}`, 'bad');
  }

  finish(reason) {
    if (this.result) return;
    const r = this.robot;
    const op = this.map.ops[this.unloadOp !== undefined ? this.unloadOp : this.realOp()];
    this.result = {
      reason,
      time: this.elapsed,
      delivered: this.delivered,
      cargoMax: CFG.robot.cargoKg,
      hits: this.hits,
      battery: Math.max(0, Math.round(r.battery)),
      phase: this.phase,
      opName: op.name,
      changed: this.task.changed,
      level: CFG.level ? CFG.level.id : 'normal',
    };
    this.endTimer = reason === 'success' ? 0.6 : 1.8;
    r.reb.on = false;
    this.sfx.rebOff();
    if (reason === 'success') this.sfx.chime();
    else setTimeout(() => this.sfx.fail(), 500);
  }

  // ---------- Рух ----------
  autopilot(dt) {
    const r = this.robot;
    const g = this.map.garage;
    const target = this.parkStage === 0 ? this.map.base : g.park;
    const dx = target.x - r.x;
    const dy = target.y - r.y;
    const d = Math.hypot(dx, dy);
    this.parkT += dt;
    if (this.parkStage === 0 && d < 16) this.parkStage = 1;
    // Підстраховка: пошкоджена ходова може не дати стати точно - через 7 с дотягуємо
    if (this.parkT > 7 && this.parkStage < 2) {
      r.x += (g.park.x - r.x) * 0.15;
      r.y += (g.park.y - r.y) * 0.15;
      this.parkStage = 1;
    }
    if (this.parkStage === 1 && d < 10) {
      this.parkStage = 2;
      this.gateTarget = 0;
    }
    if (this.parkStage >= 2) return { x: 0, y: 0, mag: 0 };
    return { x: dx / (d || 1), y: dy / (d || 1), mag: this.parkStage === 1 ? Math.min(0.55, d / 40 + 0.2) : 0.7 };
  }

  moveRobot(dt, cmd, tf) {
    const r = this.robot;
    const m = this.map;
    const R = CFG.robot;
    const tangled = r.tangle > 0;
    let target = 0;
    if (r.alive && r.powered && cmd.mag > 0.12) {
      const ta = Math.atan2(cmd.y, cmd.x);
      const diff = wrapAngle(ta - r.a);
      const tr = R.turnRate * (r.dmg.tracks ? 0.75 : 1) * (tangled ? 0.5 : 1);
      r.a = wrapAngle(r.a + clamp(diff, -tr * dt, tr * dt));
      const align = Math.abs(diff) > 1.7 ? 0 : Math.max(0, Math.cos(diff));
      target = R.maxSpeed * Math.min(1, cmd.mag) * tf * align * (r.cargo > 0 ? R.loadedFactor : 1) * (r.dmg.tracks ? 0.72 : 1);
      if (tangled) target *= CFG.tangle.speed;
    }
    if (r.dmg.tracks && r.speed > 5) r.a = wrapAngle(r.a + 0.22 * dt * r.drift);
    const rate = target > r.speed ? R.accel : R.brake;
    r.speed += clamp(target - r.speed, -rate * dt, rate * dt);
    let vx = Math.cos(r.a) * r.speed;
    let vy = Math.sin(r.a) * r.speed;
    if (r.dash.t > 0) {
      const k = r.dash.t / CFG.dash.time;
      const ds = R.maxSpeed * CFG.dash.mult * (0.35 + 0.65 * k) * (tangled ? 0.35 : 1);
      vx += r.dash.dx * ds;
      vy += r.dash.dy * ds;
      r.dash.t -= dt;
    }
    const ox = r.x;
    const oy = r.y;
    r.x = clamp(r.x + vx * dt, 30, m.W - 30);
    r.y = clamp(r.y + vy * dt, 30, m.H - 30);

    const rr = CFG.robotRadius;
    const bump = (text) => {
      r.speed = Math.min(r.speed, 22);
      r.dash.t = Math.min(r.dash.t, 0.05);
      if ((this.phase === 'outbound' || this.phase === 'return') && text) this.say('bump', 5, text, 'warn');
    };
    // Стовбури дерев - тверді
    for (const t of treesNear(m, r.x, r.y)) {
      const dx = r.x - t.x;
      const dy = r.y - t.y;
      const lim = rr + t.trunk;
      if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < lim) {
        r.x = t.x + (dx / d) * lim;
        r.y = t.y + (dy / d) * lim;
        bump('Стовбур! Крізь посадку не проїхати');
      }
    }
    // Підбита техніка й зустрічний транспорт
    for (const w of m.wrecks) {
      if (Math.abs(w.x - r.x) > 70 || Math.abs(w.y - r.y) > 70) continue;
      if (pushOutRect(r, w, rr)) bump('Підбита техніка - об\'їжджай');
    }
    for (const v of this.traffic.list) {
      if (Math.abs(v.x - r.x) > 70 || Math.abs(v.y - r.y) > 70) continue;
      if (pushOutRect(r, v, rr)) bump('');
    }
    // Річка: перебратися можна лише мостом
    if (inWater(m, r.x, r.y, rr * 0.4) && !onBridge(m, r.x, r.y) && !inWater(m, ox, oy, rr * 0.4)) {
      r.x = ox;
      r.y = oy;
      r.speed = Math.min(r.speed, 10);
      r.dash.t = 0;
      if (this.phase === 'outbound' || this.phase === 'return') this.say('river', 5, 'Річка! Переправа - тільки мостом', 'warn');
    }
    r.vx = (r.x - ox) / Math.max(dt, 0.001);
    r.vy = (r.y - oy) / Math.max(dt, 0.001);
    const sp = Math.hypot(r.vx, r.vy);
    r.moving = sp > 8;
    r.trackPhase = (r.trackPhase + r.speed * dt) % 6;
    return sp;
  }

  // ---------- Основний крок ----------
  tick(dt, input) {
    if (this.state !== 'play') return;
    const r = this.robot;
    const g = this.map.garage;

    g.gate += clamp(this.gateTarget - g.gate, -dt * 1.1, dt * 1.1);
    this.crew.update(dt);
    this.updateTracers(dt);

    if (this.result) {
      this.fx.update(dt);
      this.shake = Math.max(0, this.shake - dt * 30);
      r.speed = Math.max(0, r.speed - 200 * dt);
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.state = 'over';
        if (this.onEnd) this.onEnd(this.result);
      }
      return;
    }

    if (this.phase !== 'loading') this.elapsed += dt;
    const raw = input.command();
    for (const a of input.takeActions()) {
      if (a === 'pause') this.requestPause = true;
      else if (a === 'map') this.requestMap = true;
      else this.doAction(a, raw);
    }

    this.updateSignal();
    let cmd;
    if (this.phase === 'parking') cmd = this.autopilot(dt);
    else if (this.locked) cmd = { x: 0, y: 0, mag: 0 };
    else cmd = this.delayedCommand(raw);
    const tf = this.terrainFactor();
    const sp = this.moveRobot(dt, cmd, tf);
    r.dash.cd = Math.max(0, r.dash.cd - dt);
    r.scan.cd = Math.max(0, r.scan.cd - dt);
    r.tangle = Math.max(0, r.tangle - dt);
    r.tangleCd = Math.max(0, r.tangleCd - dt);

    // РЕБ
    if (r.reb.on) {
      r.reb.heat += dt;
      if (r.reb.heat >= CFG.reb.maxOn) {
        r.reb.on = false;
        r.reb.cd = CFG.reb.overheatCd;
        this.sfx.rebOff();
        this.toast('РЕБ перегрівся!', 'warn');
      }
    } else {
      r.reb.heat = Math.max(0, r.reb.heat - dt * 0.8);
      r.reb.cd = Math.max(0, r.reb.cd - dt);
    }

    this.updateCover();
    this.updateNav(dt);

    // Провиси сітки
    if (this.curNet && !this.locked && r.tangleCd <= 0) {
      for (const sg of this.curNet.sags) {
        if (Math.abs(sg.x - r.x) > 40 || Math.abs(sg.y - r.y) > 40) continue;
        if (dist(sg.x, sg.y, r.x, r.y) < sg.r + 8) {
          r.tangle = CFG.tangle.time;
          r.tangleCd = CFG.tangle.time + CFG.tangle.cooldown;
          this.sfx.tangle();
          vibrate(70);
          this.toast('НРК заплутався в сітці! РИВОК - щоб вирватися', 'warn');
          break;
        }
      }
    }

    // Заряд (у катсценах не витрачається)
    if (!this.locked) {
      const B = CFG.battery;
      let drain = r.moving ? B.move : B.idle;
      if (r.cargo > 0) drain *= B.loadedMult;
      if (this.offroad && r.moving) drain *= B.offroadMult;
      if (r.tangle > 0) drain *= 1.5;
      if (r.reb.on) drain += B.reb;
      if (r.dmg.battery) drain += B.leak;
      r.battery -= drain * B.mult * dt;
    }
    if (r.battery <= 20 && !this.flags.b20) {
      this.flags.b20 = true;
      this.toast('Заряд 20% - економ енергію', 'warn');
    }
    if (r.battery <= 10 && !this.flags.b10) {
      this.flags.b10 = true;
      this.toast('Заряд критичний!', 'bad');
    }
    if (r.battery <= 0) {
      r.battery = 0;
      r.powered = false;
      this.toast('НРК знеструмлено', 'bad');
      this.finish('battery');
      return;
    }
    if (this.offroad && r.moving && !this.flags.offroadT) {
      this.flags.offroadT = true;
      this.toast('Бездоріжжя: повільно, жере заряд, у полях міни', 'warn');
    }

    // Засікання на одному місці
    this.posT += dt;
    if (this.posT >= 1) {
      this.posT = 0;
      this.posHist.push({ x: r.x, y: r.y });
      if (this.posHist.length > 10) this.posHist.shift();
    }
    const ph = this.posHist;
    this.loitering = !this.locked && ph.length >= 8 && dist(r.x, r.y, ph[ph.length - 8].x, ph[ph.length - 8].y) < 70;

    // Сліди й пил
    if (!this.lastTrail || dist(this.lastTrail.x, this.lastTrail.y, r.x, r.y) > 7) {
      const gap = this.lastTrail && dist(this.lastTrail.x, this.lastTrail.y, r.x, r.y) > 30;
      const p = { x: r.x, y: r.y, nx: -Math.sin(r.a), ny: Math.cos(r.a), gap: !!gap };
      this.trail.push(p);
      this.lastTrail = p;
      if (this.trail.length > 2400) this.trail.shift();
    }
    if (r.moving) {
      this.dustT += dt * (sp / 40);
      while (this.dustT > 0.12) {
        this.dustT -= 0.12;
        this.fx.dust(r.x - Math.cos(r.a) * 28, r.y - Math.sin(r.a) * 28, r.a);
      }
    }

    // Міни
    for (const m of this.map.mines) {
      if (!m.alive) continue;
      if (m.known && m.revealT !== undefined && m.revealT < 1) m.revealT += dt * 2;
      if (Math.abs(m.x - r.x) < 14 && Math.abs(m.y - r.y) < 14 && dist(m.x, m.y, r.x, r.y) < 12) {
        m.alive = false;
        this.fx.explosion(m.x, m.y, true);
        this.addCrater(m.x, m.y, 18);
        this.sfx.explosion(true);
        this.hitRobot('mine');
        if (this.result) return;
      }
    }

    // Зміна завдання посеред шляху
    const t = this.task;
    if (this.phase === 'outbound' && t.willChange && !t.changed && this.outLen0 > 0 && this.remainPx < this.outLen0 * (1 - t.at)) {
      this.triggerTaskChange();
    }
    if (t.next !== null) this.say('task', 14, 'Штаб чекає: відкрий карту - там нове завдання', 'warn');

    // Фази
    const m = this.map;
    if (this.phase === 'loading') {
      if (r.cargo >= CFG.robot.cargoKg && this.gateTarget === 0) this.gateTarget = 1;
      if (g.gate >= 0.97 && this.gateTarget === 1) this.beginOutbound();
    } else if (this.phase === 'outbound') {
      for (const op of m.ops) {
        if (!inRotRect(r.x, r.y, op.capon, -12)) continue;
        if (op.idx === this.realOp() && t.next === null) {
          this.beginUnloading(op);
          break;
        } else if (op.status === 'fire') {
          this.say('opfire', 4, `ОП «${op.name}» під обстрілом - не приймає. Відкрий карту!`, 'bad');
        } else if (t.next !== null && op.idx === t.next) {
          this.say('opack', 4, 'Підтверди нове завдання на карті', 'warn');
        } else {
          this.say('opwrong', 4, `Це ОП «${op.name}». Твоя ціль - ОП «${m.ops[t.op].name}»`, 'warn');
        }
      }
    } else if (this.phase === 'unloading') {
      const porters = this.crew.byTag('porter');
      if (r.cargo <= 0 && porters.every((s) => !s.visible || !s.carry) && !this.flags.unloadDone) {
        this.flags.unloadDone = true;
        this.beginReturn();
      }
    } else if (this.phase === 'return') {
      if (dist(r.x, r.y, m.base.x, m.base.y) < CFG.baseRadius) this.beginParking();
    } else if (this.phase === 'parking') {
      if (this.parkStage >= 2 && g.gate <= 0.03) this.finish('success');
    }

    // Загрози й життя навколо
    this.fpv.update(dt);
    this.traffic.update(dt);
    this.fx.update(dt);
    if (this.result) return;

    // Детектор
    this.det = this.fpv.detector();
    if (this.det.count > 0) {
      if (!this.flags.firstFpv && !this.det.bomber) {
        this.flags.firstFpv = true;
        this.toast('Детектор: FPV! Ховайся під крони або в сітку, готуй РИВОК / РЕБ', 'warn');
      }
      const k = clamp(this.det.d / this.det.range, 0, 1);
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = 0.1 + k * 0.85;
        this.sfx.beep(this.det.fiber ? 'fiber' : this.det.bomber ? 'bomber' : 'radio');
      }
    } else this.beepT = 0;

    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      if (tr.t >= tr.dur) this.tracers.splice(i, 1);
    }
  }
}
