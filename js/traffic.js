import { CFG } from './config.js';
import { planRoute, pointAlong } from './nav.js';
import { clamp, dist } from './util.js';

// Зустрічний транспорт: їде з фронту на базу по своїй (правій) смузі.
// Якщо НРК стоїть на шляху - гальмує, сигналить і пробує об'їхати.
const TYPES = [
  { kind: 'pickup', w: 46, h: 22, speed: 92 },
  { kind: 'van', w: 42, h: 21, speed: 78 },
  { kind: 'quad', w: 24, h: 14, speed: 96 },
  { kind: 'nrk', w: 46, h: 34, speed: 64 },
];
const LANE = 20;

export class Traffic {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.t = CFG.traffic.firstAt;
  }

  update(dt) {
    const g = this.g;
    if ((g.phase === 'outbound' || g.phase === 'return') && g.route) {
      this.t -= dt;
      if (this.t <= 0) {
        this.t = CFG.traffic.min + Math.random() * (CFG.traffic.max - CFG.traffic.min);
        this.trySpawn();
      }
    }
    for (const v of this.list) this.step(v, dt);
    this.list = this.list.filter((v) => !v.dead);
  }

  trySpawn() {
    const g = this.g;
    const D = 1050 + Math.random() * 300;
    if (!g.route || g.route.len < D + 150) return;
    const p = pointAlong(g.route, D);
    const path = planRoute(g.map, p.x, p.y, g.map.base.node);
    if (!path || path.len < 700) return;
    const t = TYPES[Math.floor(Math.random() * TYPES.length)];
    const v = { ...t, path, u: 0, k: 0, lane: LANE, laneT: LANE, cur: t.speed, x: p.x, y: p.y, a: 0, blockedT: 0, honked: false, dead: false, dustT: 0, bob: Math.random() * 6 };
    this.place(v);
    this.list.push(v);
  }

  place(v) {
    const p = pointAlong(v.path, v.u, v.k);
    v.k = p.i;
    v.a = Math.atan2(p.ty, p.tx);
    v.x = p.x - p.ty * v.lane;
    v.y = p.y + p.tx * v.lane;
  }

  step(v, dt) {
    const g = this.g;
    const r = g.robot;
    const c = Math.cos(v.a);
    const s = Math.sin(v.a);
    const dx = r.x - v.x;
    const dy = r.y - v.y;
    const fwd = dx * c + dy * s;
    const lat = -dx * s + dy * c;
    const blocked = fwd > 0 && fwd < v.w / 2 + 56 && Math.abs(lat) < v.h / 2 + 24;
    const target = blocked ? 0 : v.speed;
    v.cur += clamp(target - v.cur, -280 * dt, 80 * dt);
    if (blocked) {
      v.blockedT += dt;
      if (v.blockedT > 1.1 && !v.honked) {
        v.honked = true;
        if (dist(v.x, v.y, r.x, r.y) < 500) g.sfx.horn();
      }
      if (v.blockedT > 2.0) v.laneT = lat > 0 ? -26 : LANE + 18;
    } else {
      v.blockedT = 0;
      if (v.laneT !== LANE && fwd < -50) {
        v.laneT = LANE;
        v.honked = false;
      }
    }
    v.lane += clamp(v.laneT - v.lane, -45 * dt, 45 * dt);
    v.u += v.cur * dt;
    v.bob += dt * (v.cur / 10);
    this.place(v);
    if (v.cur > 20) {
      v.dustT += dt;
      if (v.dustT > 0.14) {
        v.dustT = 0;
        if (dist(v.x, v.y, r.x, r.y) < 900) g.fx.dust(v.x - Math.cos(v.a) * v.w * 0.55, v.y - Math.sin(v.a) * v.w * 0.55, v.a);
      }
    }
    if (v.u >= v.path.len - 140 || dist(v.x, v.y, r.x, r.y) > 2100) v.dead = true;
  }
}
