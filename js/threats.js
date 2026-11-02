import { CFG } from './config.js';
import { clamp, dist, inRotRect } from './util.js';
import { netAt, dangerAt, onBridge, inWater, roadAt } from './map.js';
import { pointAlong } from './nav.js';
import { makeRng } from './rng.js';

const rand = (a, b) => a + Math.random() * (b - a);

// Усе, що летить: FPV (радіо й оптоволокно), дрони зі скидами, їхні скиди й арта.
export class FpvManager {
  constructor(game) {
    this.g = game;
    this.list = []; // дрони
    this.drops = []; // те, що падає з дронів
    this.shells = []; // прильоти
    this.exposure = 0;
    this.sinceSpawn = 0;
    this.count = 0;
    this.ambT = 8;
    this.aimT = 14;
    this.fireT = 3;
    this.salvoT = 0;
  }

  make(kind, x, y, tx, ty) {
    this.count++;
    return {
      id: this.count,
      kind,
      fiber: kind === 'fiber',
      bomber: kind === 'bomber',
      x,
      y,
      sx: x,
      sy: y,
      z: kind === 'bomber' ? CFG.bomber.z : CFG.fpv.cruiseZ,
      vx: 0,
      vy: 0,
      state: 'approach',
      lastX: tx,
      lastY: ty,
      orbitA: 0,
      searchT: 0,
      leaveA: 0,
      leaveT: 0,
      diveT: 0,
      dx0: 0,
      dy0: 0,
      ix: 0,
      iy: 0,
      drops: CFG.bomber.drops,
      aimT: 0,
      coverT: 0,
      mined: false,
      dead: false,
      heading: Math.atan2(ty - y, tx - x),
      spin: 0,
      known: false,
      riseT: 0,
    };
  }

  spawn(kind) {
    const r = this.g.robot;
    const ang = (Math.random() * 2 - 1) * 1.2; // переважно зі сходу, з боку ворога
    const d = kind === 'bomber' ? 720 : CFG.fpv.spawnDist;
    const x = r.x + Math.cos(ang) * d;
    const y = r.y + Math.sin(ang) * d;
    this.list.push(this.make(kind, x, y, r.x, r.y));
    const g = this.g;
    if (kind === 'fiber' && !g.flags.fiberWarned) {
      g.flags.fiberWarned = true;
      g.toast('Оптоволоконний FPV - РЕБ не діє!', 'warn');
    }
    if (kind === 'bomber' && !g.flags.bomberWarned) {
      g.flags.bomberWarned = true;
      g.toast('БПЛА зі скидами! Дивись на червоне коло й міняй курс', 'warn');
    }
  }

  // Ждуни: розкладаються від сиду (у друзів на тій самій карті й рівні - однаково),
  // більшість - на шляху до цілі, решта - на інших дорогах ближче до фронту
  setupAmbush(seed) {
    const A = CFG.ambush;
    const g = this.g;
    const m = g.map;
    g.map.ambushN = 0;
    if (!A.count) return;
    const rnd = makeRng((seed ^ 0x2c1b3c6d) >>> 0);
    const HALF = CFG.road.width / 2;
    const spots = [];
    const ok = (x, y) => {
      if (dangerAt(m, x) < 0.3 || netAt(m, x, y)) return false;
      if (onBridge(m, x, y) || inWater(m, x, y, 30)) return false;
      if (m.ops.some((op) => dist(op.capon.x, op.capon.y, x, y) < 480)) return false;
      if (m.mines.some((mi) => dist(mi.x, mi.y, x, y) < 90)) return false;
      if (m.wrecks.some((w) => dist(w.x, w.y, x, y) < 90)) return false;
      return !spots.some((q) => dist(q.x, q.y, x, y) < 600);
    };
    const put = (p, nx, ny) => {
      const off = (rnd() < 0.5 ? 1 : -1) * (HALF - 4 + rnd() * 20);
      const x = p.x + nx * off;
      const y = p.y + ny * off;
      if (ok(x, y)) spots.push({ x, y, fiber: rnd() < A.fiber, a: Math.atan2(p.ty, p.tx) });
    };
    const route = g.route;
    const onRoute = Math.ceil(A.count * 0.6);
    for (let k = 0; route && route.len > 400 && k < 200 && spots.length < onRoute; k++) {
      const p = pointAlong(route, rnd() * route.len);
      put(p, -p.ty, p.tx);
    }
    for (let k = 0; k < 500 && spots.length < A.count; k++) {
      const e = m.edges[Math.floor(rnd() * m.edges.length)];
      if (e.len < 400) continue;
      const p = roadAt(e, 150 + rnd() * (e.len - 300));
      put(p, p.nx, p.ny);
    }
    for (const q of spots) {
      const f = this.make(q.fiber ? 'fiber' : 'fpv', q.x, q.y, q.x + Math.cos(q.a), q.y + Math.sin(q.a));
      f.ambush = true;
      f.state = 'wait';
      f.z = 0;
      f.sx = q.x;
      f.sy = q.y;
      this.list.push(f);
    }
    m.ambushN = spots.length;
  }

  // Скан показує ждунів поруч
  reveal(x, y, rad) {
    let n = 0;
    for (const f of this.list) {
      if (f.state !== 'wait' || f.known) continue;
      if (dist(f.x, f.y, x, y) < rad) {
        f.known = true;
        n++;
      }
    }
    return n;
  }

  steer(f, tx, ty, speed, dt, arrive = 0) {
    const dx = tx - f.x;
    const dy = ty - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = arrive ? speed * Math.min(1, d / arrive) : speed;
    const k = Math.min(1, 3 * dt);
    f.vx += ((dx / d) * sp - f.vx) * k;
    f.vy += ((dy / d) * sp - f.vy) * k;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (Math.abs(f.vx) + Math.abs(f.vy) > 1) f.heading = Math.atan2(f.vy, f.vx);
  }

  spawnLogic(dt) {
    const g = this.g;
    const r = g.robot;
    const E = CFG.exposure;
    const dng = g.danger;
    const inRisk = (g.phase === 'outbound' || g.phase === 'return') && dng > CFG.rearDanger;
    if (g.elapsed < E.grace || !inRisk || !r.alive) {
      this.exposure = Math.max(0, this.exposure - 5 * dt);
      return;
    }
    const inten = 0.55 + 0.85 * dng;
    let dE = g.inCover ? E.cover : (r.moving ? E.openMove : E.openStill) * inten * E.mult;
    if (g.loitering) dE += E.loiter;
    this.exposure = clamp(this.exposure + dE * dt, 0, 100);
    this.sinceSpawn += dt;

    const S = CFG.spawn;
    const maxN = dng < S.highAt ? S.maxLow : dng < S.frontAt ? S.maxHigh : S.maxFront;
    let active = 0;
    for (const f of this.list) if (f.state !== 'leave' && f.state !== 'jammed' && f.state !== 'wait') active++;
    // Примусовий дрон раз на maxGap - тільки ближче до фронту, а не на підході до бази
    const forced = this.sinceSpawn > E.maxGap && dng > 0.3;
    if (active < maxN && (this.exposure >= E.spawnAt || forced)) {
      const hasBomber = this.list.some((f) => f.bomber && f.state !== 'leave' && f.state !== 'jammed');
      let kind = 'fpv';
      if (!hasBomber && dng > 0.2 && Math.random() < S.bomber) kind = 'bomber';
      else if (dng > S.fiberAt && Math.random() < S.fiber) kind = 'fiber';
      this.spawn(kind);
      this.exposure = E.resetTo;
      this.sinceSpawn = 0;
    }
  }

  // Піхота на будь-якому ОП збиває все, що підлітає до позиції
  opDefense(f, dt) {
    if (f.state === 'wait') return false;
    const g = this.g;
    for (const op of g.map.ops) {
      const d = op.defense;
      if (Math.abs(f.x - d.x) > d.r || Math.abs(f.y - d.y) > d.r) continue;
      if (dist(f.x, f.y, d.x, d.y) >= d.r) continue;
      f.shotT = (f.shotT || 0) + dt;
      if (f.shotT > 0.9) {
        f.dead = true;
        const hy = f.y - f.z * 0.12;
        g.addTracers(op.posts.slice(0, 2), f.x, hy);
        g.fx.explosion(f.x, hy, false);
        if (dist(f.x, f.y, g.robot.x, g.robot.y) < 900) {
          g.sfx.explosion(false);
          g.toast(f.bomber ? 'Піхота збила дрон зі скидами' : 'Піхота збила FPV', 'good');
        }
        return true;
      }
    }
    return false;
  }

  update(dt) {
    const g = this.g;
    const r = g.robot;
    const F = CFG.fpv;
    this.spawnLogic(dt);

    const visible = !g.inCover && r.alive && !g.locked;
    const away = this.outOfReach();

    for (const f of this.list) {
      if (f.dead) continue;
      f.spin += dt * 40;
      if (away && f.state !== 'leave' && f.state !== 'jammed' && f.state !== 'dive' && f.state !== 'wait') this.leave(f);
      if (f.state !== 'jammed' && this.opDefense(f, dt)) continue;
      if (f.bomber) {
        this.updateBomber(f, dt, visible);
        continue;
      }
      const speed = f.fiber ? F.fiberSpeed : F.speed;
      const d = dist(f.x, f.y, r.x, r.y);

      // Ждун лежить, доки НРК не підійде на видноті
      if (f.state === 'wait') {
        if (d > 900) continue;
        if (!f.fiber && r.reb.on && d < CFG.reb.radius) {
          // РЕБ рве канал керування - ждун так і лишиться на землі
          f.dead = true;
          g.sfx.jam();
          g.toast('Ждуна подавлено РЕБ - вже не злетить', 'good');
          continue;
        }
        if (visible && d < CFG.ambush.wake) {
          f.state = 'rise';
          f.riseT = 0;
          f.known = true;
          f.lastX = r.x;
          f.lastY = r.y;
          g.sfx.beep(f.fiber ? 'fiber' : 'radio');
          if (!g.flags.ambushWarned) {
            g.flags.ambushWarned = true;
            g.toast('ЖДУН! FPV чекав на узбіччі. СКАН показує їх заздалегідь', 'bad');
          } else g.toast(f.fiber ? 'Ждун на оптоволокні злетів - РИВОК!' : 'Ждун злетів!', 'bad');
        }
        continue;
      }

      if (f.state === 'jammed') {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.heading += dt * 9;
        f.z -= 38 * dt;
        if (f.z <= 0) {
          f.dead = true;
          g.fx.explosion(f.x, f.y, false);
          g.addCrater(f.x, f.y, 10);
          g.sfx.explosion(false);
          if (dist(f.x, f.y, r.x, r.y) < 20) g.hitRobot('fpv');
        }
        continue;
      }

      // Власний РЕБ глушить радіо-FPV у радіусі, навіть у піке
      if (!f.fiber && r.reb.on && d < CFG.reb.radius) {
        f.state = 'jammed';
        const a = Math.random() * Math.PI * 2;
        f.vx = f.vx * 0.3 + Math.cos(a) * 45;
        f.vy = f.vy * 0.3 + Math.sin(a) * 45;
        g.sfx.jam();
        g.toast('FPV подавлено РЕБ', 'good');
        continue;
      }

      if (f.state === 'rise') {
        f.riseT += dt;
        f.z = F.cruiseZ * 0.7 * Math.min(1, f.riseT / CFG.ambush.rise);
        f.heading = Math.atan2(r.y - f.y, r.x - f.x);
        if (visible) {
          f.lastX = r.x;
          f.lastY = r.y;
        }
        if (f.riseT >= CFG.ambush.rise) f.state = 'hunt';
        continue;
      }

      if (f.state === 'dive') {
        f.diveT -= dt;
        if (visible) {
          const hx = r.x - f.ix;
          const hy = r.y - f.iy;
          const hd = Math.hypot(hx, hy);
          if (hd > 0.1) {
            const m = Math.min(hd, F.homing * dt);
            f.ix += (hx / hd) * m;
            f.iy += (hy / hd) * m;
          }
        }
        const k = 1 - Math.max(0, f.diveT) / F.diveTime;
        f.x = f.dx0 + (f.ix - f.dx0) * k;
        f.y = f.dy0 + (f.iy - f.dy0) * k;
        f.z = F.cruiseZ * (1 - k);
        if (f.diveT <= 0) this.impact(f);
        continue;
      }

      if (visible) {
        f.lastX = r.x;
        f.lastY = r.y;
      }

      if (f.state === 'approach' || f.state === 'hunt') {
        if (!visible && d < F.acquire) {
          f.state = 'search';
          f.searchT = F.searchTime;
          f.orbitA = Math.atan2(f.y - f.lastY, f.x - f.lastX);
        } else {
          this.steer(f, f.lastX, f.lastY, speed, dt);
          if (visible && d < F.acquire) f.state = 'hunt';
          if (visible && d < F.diveDist) this.startDive(f);
          else if (!visible && dist(f.x, f.y, f.lastX, f.lastY) < 40) {
            f.state = 'search';
            f.searchT = F.searchTime;
          }
        }
      } else if (f.state === 'search') {
        f.searchT -= dt;
        f.orbitA += dt * 1.3;
        this.steer(f, f.lastX + Math.cos(f.orbitA) * 95, f.lastY + Math.sin(f.orbitA) * 95, speed * 0.8, dt);
        if (visible && d < F.acquire) f.state = 'hunt';
        else if (f.searchT <= 0) this.leave(f);
      } else if (f.state === 'leave') {
        f.leaveT += dt;
        this.steer(f, f.x + Math.cos(f.leaveA) * 100, f.y + Math.sin(f.leaveA) * 100, speed, dt);
        if (visible && !away && d < F.acquire * 0.7) f.state = 'hunt';
        else if (f.leaveT > 7 || d > 760) f.dead = true;
      }
    }
    this.list = this.list.filter((f) => !f.dead);
    this.updateDrops(dt);
    this.updateShells(dt);
  }

  // Дрон повертається до своїх - на схід
  leave(f) {
    f.state = 'leave';
    f.leaveA = (Math.random() - 0.5) * 1.6;
    f.leaveT = 0;
  }

  // НРК у тилу, на базі чи рейс скінчився - дрони далі не летять
  outOfReach() {
    const g = this.g;
    return g.danger < CFG.rearDanger * 0.7 || g.phase === 'parking' || g.phase === 'loading' || !!g.result;
  }

  // ---------- Дрон зі скидами ----------
  updateBomber(f, dt, visible) {
    const g = this.g;
    const r = g.robot;
    const B = CFG.bomber;
    const d = dist(f.x, f.y, r.x, r.y);

    if (f.state === 'jammed') {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.heading += dt * 2;
      f.leaveT += dt;
      if (f.leaveT > 4) f.dead = true;
      return;
    }
    if (r.reb.on && d < CFG.reb.radius + 30) {
      f.state = 'jammed';
      const a = Math.random() * Math.PI * 2;
      f.vx = Math.cos(a) * 40;
      f.vy = Math.sin(a) * 40;
      f.leaveT = 0;
      g.sfx.jam();
      g.toast('Дрон зі скидами втратив зв\'язок', 'good');
      return;
    }
    if (f.state === 'leave') {
      f.leaveT += dt;
      this.steer(f, f.x + Math.cos(f.leaveA) * 100, f.y + Math.sin(f.leaveA) * 100, B.speed * 1.3, dt);
      if (f.leaveT > 7 || d > 950) f.dead = true;
      return;
    }
    if (f.drops <= 0) {
      this.leave(f);
      return;
    }
    if (visible) {
      f.lastX = r.x;
      f.lastY = r.y;
      f.coverT = 0;
    } else f.coverT += dt;

    // НРК сховався: дрон мінує дорогу попереду і летить геть
    if (!visible && f.coverT > B.coverWait && !f.mined && d < 320) {
      f.mined = true;
      this.layMines(f);
      this.leave(f);
      return;
    }
    if (!visible && f.coverT > B.coverWait * 2.2) {
      this.leave(f);
      return;
    }

    // Зависає над точкою, де НРК буде, коли скид долетить
    const tx = visible ? r.x + r.vx * B.fallTime : f.lastX;
    const ty = visible ? r.y + r.vy * B.fallTime : f.lastY;
    this.steer(f, tx, ty, B.speed, dt, 70);
    const dd = dist(f.x, f.y, tx, ty);
    if (f.state === 'approach' && dd < 140) f.state = 'aim';
    if (f.state === 'aim' && visible) {
      if (dd < 24) f.aimT += dt;
      else f.aimT = Math.max(0, f.aimT - dt * 0.5);
      if (f.aimT >= B.aimTime) {
        this.drop(f.x, f.y, f.z, 'grenade');
        f.aimT = -0.7;
        f.drops--;
      }
    }
  }

  drop(x, y, z, kind) {
    this.drops.push({ kind, x, y, z, t: 0, dur: CFG.bomber.fallTime, r: kind === 'grenade' ? CFG.bomber.blast : 10 });
    this.g.sfx.dropFall();
  }

  layMines(f) {
    const g = this.g;
    const r = g.robot;
    let p;
    if (g.route && g.route.len > 220) p = pointAlong(g.route, 170 + Math.random() * 60);
    else p = { x: r.x + Math.cos(r.a) * 180, y: r.y + Math.sin(r.a) * 180, tx: Math.cos(r.a), ty: Math.sin(r.a) };
    for (const side of [-1, 1]) {
      const along = (Math.random() - 0.5) * 50;
      const lat = side * (8 + Math.random() * 18);
      this.drops.push({
        kind: 'mine',
        x: p.x + p.tx * along - p.ty * lat,
        y: p.y + p.ty * along + p.tx * lat,
        z: f.z,
        t: -Math.random() * 0.3,
        dur: CFG.bomber.fallTime,
        r: 10,
      });
    }
    this.g.sfx.dropFall();
    if (g.signal.bars >= 3) g.toast('Дрон скинув міни на дорогу попереду!', 'warn');
  }

  updateDrops(dt) {
    const g = this.g;
    const r = g.robot;
    for (const d of this.drops) {
      d.t += dt;
      if (d.t < d.dur || d.done) continue;
      d.done = true;
      const net = netAt(g.map, d.x, d.y);
      if (net) {
        if (d.kind === 'grenade') {
          g.fx.explosion(d.x, d.y, false);
          g.sfx.explosion(false);
          g.tearNet(net, d.x, d.y);
        }
        if (dist(d.x, d.y, r.x, r.y) < 500) g.toast(d.kind === 'grenade' ? 'Скид застряг у сітці!' : 'Міна застрягла в сітці', 'good');
        continue;
      }
      if (d.kind === 'grenade') {
        g.fx.explosion(d.x, d.y, false);
        g.addCrater(d.x, d.y, 9);
        g.sfx.explosion(false);
        const dd = dist(d.x, d.y, r.x, r.y);
        if (r.alive && dd < d.r) g.hitRobot('drop');
        else if (r.alive && dd < 80) {
          g.shake = Math.max(g.shake, 5);
          g.toast('Скид поруч - ухилився!', 'good');
        }
      } else {
        // Міну видно, якщо камера бачила, куди вона впала
        const seen = dist(d.x, d.y, r.x, r.y) < 430 && g.signal.bars >= 3;
        g.map.mines.push({ x: d.x, y: d.y, known: seen, revealT: 0, alive: true, ha: Math.random() * 3, field: false, dropped: true });
      }
    }
    this.drops = this.drops.filter((d) => !d.done);
  }

  // ---------- Арта ----------
  addShell(x, y, aimed) {
    const warn = aimed ? CFG.shell.warn : rand(0.5, 1.1);
    this.shells.push({ x, y, t: warn, dur: warn, aimed });
    if (aimed) this.g.sfx.whistle(warn);
  }

  updateShells(dt) {
    const g = this.g;
    const r = g.robot;
    const S = CFG.shell;
    const m = g.map;
    const active = g.phase === 'outbound' || g.phase === 'return' || g.phase === 'unloading';
    const safe = (x, y) => {
      if (inRotRect(x, y, m.garage, 260)) return false;
      for (const op of m.ops) if (op.status !== 'fire' && dist(x, y, op.capon.x, op.capon.y) < 240) return false;
      return x > 0 && y > 0 && x < m.W && y < m.H;
    };
    if (active && g.elapsed > 20) {
      // Фонові прильоти навколо
      if (g.danger > 0.12) {
        this.ambT -= dt;
        if (this.ambT <= 0) {
          this.ambT = rand(S.ambientMin, S.ambientMax) * (1.25 - g.danger * 0.5);
          const a = Math.random() * Math.PI * 2;
          const dd = rand(280, 700);
          const x = r.x + Math.cos(a) * dd;
          const y = r.y + Math.sin(a) * dd;
          if (safe(x, y)) this.addShell(x, y, false);
        }
      }
      // Пристрілка, якщо НРК довго світиться
      if (g.danger > 0.3 && !g.locked && (g.loitering || this.exposure > S.aimedAt)) {
        this.aimT -= dt;
        if (this.aimT <= 0) {
          this.aimT = rand(S.aimedMin, S.aimedMax);
          const a = Math.random() * Math.PI * 2;
          const off = rand(35, 75);
          const x = r.x + Math.cos(a) * off;
          const y = r.y + Math.sin(a) * off;
          if (safe(x, y)) {
            this.addShell(x, y, true);
            if (S.salvo > 1) this.salvoT = rand(0.8, 1.2);
            if (!g.flags.shellWarned) {
              g.flags.shellWarned = true;
              g.toast('Тебе пристрілюють! Виходь з червоного кола', 'bad');
            }
          }
        }
      } else this.aimT = Math.max(this.aimT, 5);
      // «Вилка»: другий приліт - точно туди, де НРК зараз. Хто їде - встигає вийти з кола
      if (this.salvoT > 0) {
        this.salvoT -= dt;
        if (this.salvoT <= 0 && !g.locked && r.alive) {
          const a = Math.random() * Math.PI * 2;
          const off = rand(0, 14);
          const x = r.x + Math.cos(a) * off;
          const y = r.y + Math.sin(a) * off;
          if (safe(x, y)) {
            this.addShell(x, y, true);
            if (!g.flags.salvoWarned) {
              g.flags.salvoWarned = true;
              g.toast('Арта б\'є вилкою: другий приліт - туди, де ти зараз. Міняй курс!', 'bad');
            }
          }
        }
      }
      // ОП, з якого зняли завдання, під обстрілом
      const fireOps = m.ops.filter((op) => op.status === 'fire');
      if (fireOps.length) {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = rand(2.2, 4.5);
          const op = fireOps[Math.floor(Math.random() * fireOps.length)];
          const a = Math.random() * Math.PI * 2;
          const dd = rand(20, 230);
          this.addShell(op.capon.x + Math.cos(a) * dd, op.capon.y + Math.sin(a) * dd, false);
        }
      }
    }
    for (const s of this.shells) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.done = true;
      const dd = dist(s.x, s.y, r.x, r.y);
      if (dd > 1300) {
        g.addCrater(s.x, s.y, 16);
        continue;
      }
      g.fx.explosion(s.x, s.y, true);
      g.addCrater(s.x, s.y, s.aimed ? 18 : 16);
      g.sfx.explosion(true, clamp(1.1 - dd / 1200, 0.15, 1));
      if (dd < 300) g.shake = Math.max(g.shake, 10 * (1 - dd / 300));
      if (r.alive && dd < S.blast) g.hitRobot('shell');
      // Уламки рвуть сітку
      const net = netAt(g.map, s.x, s.y);
      if (net) g.tearNet(net, s.x, s.y);
    }
    this.shells = this.shells.filter((s) => !s.done);
  }

  // ---------- FPV ----------
  startDive(f) {
    const r = this.g.robot;
    const F = CFG.fpv;
    f.state = 'dive';
    f.diveT = F.diveTime;
    f.dx0 = f.x;
    f.dy0 = f.y;
    const lead = F.diveTime * 0.75;
    f.ix = r.x + r.vx * lead;
    f.iy = r.y + r.vy * lead;
    this.g.sfx.dive();
  }

  impact(f) {
    const g = this.g;
    const r = g.robot;
    f.dead = true;
    // Антидронова сітка ловить дрон, якщо в цьому місці ще немає дірки
    const net = netAt(g.map, f.ix, f.iy);
    if (net && !net.holes.some((h) => dist(h.x, h.y, f.ix, f.iy) < 26)) {
      g.tearNet(net, f.ix, f.iy);
      g.fx.explosion(f.ix, f.iy, false);
      g.sfx.explosion(false);
      g.shake = Math.max(g.shake, 4);
      g.toast('FPV заплутався в сітці! Сітку порвано - там провис', 'good');
      return;
    }
    g.fx.explosion(f.ix, f.iy, false);
    g.addCrater(f.ix, f.iy, 13);
    g.sfx.explosion(false);
    g.shake = Math.max(g.shake, 6);
    if (r.alive && dist(r.x, r.y, f.ix, f.iy) < CFG.fpv.hitRadius) g.hitRobot('fpv');
    else if (r.alive) g.toast('Промах! FPV не влучив', 'good');
  }

  // Що бачить детектор: радіо-FPV і дрони зі скидами здалеку, оптоволокно - лише акустично зблизька
  range(f) {
    if (f.bomber) return CFG.bomber.detect;
    return f.fiber ? CFG.fpv.fiberDetect : CFG.fpv.detectRange;
  }

  detector() {
    const r = this.g.robot;
    let best = null;
    let bestD = Infinity;
    let count = 0;
    for (const f of this.list) {
      if (f.state === 'jammed' || f.state === 'wait') continue;
      const d = dist(f.x, f.y, r.x, r.y);
      if (d > this.range(f)) continue;
      count++;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best ? { count, f: best, d: bestD, fiber: best.fiber, bomber: best.bomber, range: this.range(best) } : { count: 0 };
  }
}
