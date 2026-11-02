import { CFG } from './config.js';
import { makeRng } from './rng.js';
import { clamp, dist, inRotRect } from './util.js';

export const CROWNS = [
  ['#2F7D32', '#3E9A3D'],
  ['#2E7330', '#3B8D3A'],
  ['#357F2E', '#47A03C'],
  ['#2B6E34', '#3A8A42'],
];
const FIELDS = ['#7CA246', '#92B95A', '#8BB052', '#9CC062', '#79A044', '#88AD4E'];
const PLOWED = ['#AFBE6A', '#B9B072', '#A7B565', '#C9B458', '#D2BE62'];
const NET_LEAVES = ['#5B6E3A', '#6E7A45', '#4A5A30', '#8A7A50', '#3F4E2A'];
export const CALLSIGNS = ['ЯВІР', 'ГРАНІТ', 'ЛЕЛЕКА', 'СОКІЛ', 'БЕРЕСТ', 'ВІЛЬХА', 'ЯСЕН', 'КЕДР', 'ОРІЛ', 'ТУР', 'ЧАЙКА', 'ДУБ'];

const CELL = 160; // клітинка індексу доріг
const TCELL = 120; // клітинка індексу дерев
const key = (ix, iy) => ix * 4096 + iy;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

// Локальна система координат: x - вперед по осі a, y - вбік
function frame(ox, oy, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (lx, ly) => ({ x: ox + lx * c - ly * s, y: oy + lx * s + ly * c });
}

// Гладка полілінія з кроком ~8 px: координата s, дотична t, нормаль n
function smoothPath(ctrl, step = 8) {
  const pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(dist(p1.x, p1.y, p2.x, p2.y) / step));
    for (let k = 0; k < steps; k++) pts.push(catmull(p0, p1, p2, p3, k / steps));
  }
  const last = ctrl[ctrl.length - 1];
  pts.push({ x: last.x, y: last.y });
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) L += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    pts[i].s = L;
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    pts[i].tx = dx / len;
    pts[i].ty = dy / len;
    pts[i].nx = -dy / len;
    pts[i].ny = dx / len;
  }
  return { pts, len: L };
}

// ---------- Запити до карти ----------
export function roadAt(edge, s) {
  const pts = edge.pts;
  const ss = clamp(s, 0, edge.len);
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s < ss) lo = mid + 1;
    else hi = mid;
  }
  return pts[lo];
}

// Найближча точка будь-якої дороги. Пошук кільцями по сітці, тому швидкий навіть на великій карті.
export function nearestRoad(map, x, y, maxR = 700) {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  let best = Infinity;
  let be = -1;
  let bi = -1;
  const maxK = Math.ceil(maxR / CELL);
  for (let k = 0; k <= maxK; k++) {
    for (let ix = cx - k; ix <= cx + k; ix++) {
      for (let iy = cy - k; iy <= cy + k; iy++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== k) continue;
        const arr = map.roadIdx.get(key(ix, iy));
        if (!arr) continue;
        for (const code of arr) {
          const e = code >> 16;
          const i = code & 0xffff;
          const p = map.edges[e].pts[i];
          const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
          if (d2 < best) {
            best = d2;
            be = e;
            bi = i;
          }
        }
      }
    }
    if (be >= 0 && Math.sqrt(best) <= k * CELL) break;
  }
  if (be < 0) return null;
  const p = map.edges[be].pts[bi];
  return { d: Math.sqrt(best), e: be, i: bi, s: p.s, p };
}

export function dangerAt(map, x) {
  return clamp((x - map.dangerX0) / (map.dangerX1 - map.dangerX0), 0, 1);
}

export function streamX(map, y) {
  const st = map.stream;
  const f = clamp((y - st.y0) / st.step, 0, st.xs.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(st.xs.length - 1, i0 + 1);
  return st.xs[i0] + (st.xs[i1] - st.xs[i0]) * (f - i0);
}

export function inWater(map, x, y, pad = 0) {
  const st = map.stream;
  if (!st) return false;
  if (Math.abs(x - streamX(map, y)) > st.w / 2 + pad + 80) return false;
  const i0 = Math.max(0, Math.floor((y - st.y0 - 90) / st.step));
  const i1 = Math.min(st.xs.length - 1, Math.ceil((y - st.y0 + 90) / st.step));
  let best = Infinity;
  for (let i = i0; i <= i1; i++) {
    const sx = st.xs[i];
    const sy = st.y0 + i * st.step;
    const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
    if (d < best) best = d;
  }
  return Math.sqrt(best) < st.w / 2 + pad;
}

export function onBridge(map, x, y) {
  const half = CFG.road.width / 2 + 8;
  for (const b of map.bridges) {
    if (b.broken) continue;
    // Косий міст буває довшим за 160 px - межа пошуку від його довжини
    const reach = b.len / 2 + 60;
    if (Math.abs(b.x - x) > reach || Math.abs(b.y - y) > reach) continue;
    if (inRotRect(x, y, { x: b.x, y: b.y, w: b.len + 16, h: CFG.road.width + 8, a: b.a })) return true;
    // Дорога на мосту може вигинатися: тоді рахуємо по самій осі дороги
    const e = map.edges[b.e];
    const s0 = b.s - b.len / 2 - 10;
    const s1 = b.s + b.len / 2 + 10;
    for (const p of e.pts) {
      if (p.s < s0 || p.s > s1) continue;
      if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < half * half) return true;
    }
  }
  return false;
}

export function treesNear(map, x, y) {
  const out = map._near;
  out.length = 0;
  const cx = Math.floor(x / TCELL);
  const cy = Math.floor(y / TCELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const arr = map.treeGrid.get(key(ix, iy));
      if (arr) for (const i of arr) out.push(map.trees[i]);
    }
  }
  return out;
}

export function netAt(map, x, y) {
  for (const nt of map.nets) {
    if (x < nt.bb.x0 - 4 || x > nt.bb.x1 + 4 || y < nt.bb.y0 - 4 || y > nt.bb.y1 + 4) continue;
    const h2 = nt.half * nt.half;
    for (const c of nt.center) if ((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y) <= h2) return nt;
  }
  return null;
}

// Умовні координати в метрах для тактичної карти
export function gridCoord(map, x, y) {
  const M = CFG.metersPerPx;
  return { X: map.grid.x0 + Math.round(x * M), Y: map.grid.y0 + Math.round((map.H - y) * M) };
}

function reachable(map, from) {
  const ok = new Array(map.nodes.length).fill(false);
  const stack = [from];
  ok[from] = true;
  while (stack.length) {
    const u = stack.pop();
    for (const ei of map.nodes[u].adj) {
      const e = map.edges[ei];
      if (e.broken) continue;
      const v = e.a === u ? e.b : e.a;
      if (!ok[v]) {
        ok[v] = true;
        stack.push(v);
      }
    }
  }
  return ok;
}

// ---------- Генерація ----------
export function generateMap(seed) {
  const rnd = makeRng(seed);
  const W = CFG.world.w;
  const H = CFG.world.h;
  const HALF = CFG.road.width / 2;
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const map = {
    seed,
    W,
    H,
    nodes: [],
    edges: [],
    bridges: [],
    nets: [],
    trees: [],
    ruins: [],
    wrecks: [],
    craters: [],
    mud: [],
    mines: [],
    minefields: [],
    rebZones: [],
    fields: [],
    plowed: [],
    fences: [],
    covers: [],
    _near: [],
  };

  // --- Вузли: база на заході, три ряди перехресть, три ОП на сході ---
  const rowsY = [0.2, 0.5, 0.8].map((f) => H * f + rnd.range(-H * 0.04, H * 0.04));
  const colsX = [0.23, 0.43, 0.63, 0.81].map((f) => W * f + rnd.range(-110, 110));
  const addNode = (x, y, kind) => {
    const n = { id: map.nodes.length, x, y, kind, adj: [] };
    map.nodes.push(n);
    return n;
  };
  const baseNode = addNode(430, rowsY[1] + rnd.range(-140, 140), 'base');
  const J = colsX.map((cx) => rowsY.map((ry) => addNode(cx + rnd.range(-90, 90), ry + rnd.range(-110, 110), 'junction')));
  const opNodes = rowsY.map((ry) => addNode(W - 440 + rnd.range(-50, 50), ry + rnd.range(-100, 100), 'op'));

  const addEdge = (A, B, opts = {}) => {
    const L = dist(A.x, A.y, B.x, B.y);
    const ctrl = [{ x: A.x, y: A.y }];
    if (opts.startDir) ctrl.push({ x: A.x + opts.startDir[0] * 180, y: A.y + opts.startDir[1] * 180 });
    const n = Math.max(1, Math.round(L / 430));
    const jit = Math.min(opts.jitter ?? 130, L * 0.1);
    const ux = (B.x - A.x) / L;
    const uy = (B.y - A.y) / L;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const j = rnd.range(-jit, jit);
      ctrl.push({ x: A.x + (B.x - A.x) * t - uy * j, y: A.y + (B.y - A.y) * t + ux * j });
    }
    if (opts.endDir) ctrl.push({ x: B.x - opts.endDir[0] * 200, y: B.y - opts.endDir[1] * 200 });
    ctrl.push({ x: B.x, y: B.y });
    const { pts, len } = smoothPath(ctrl);
    const e = { id: map.edges.length, a: A.id, b: B.id, pts, len, broken: false, breakS: 0, crossings: 0 };
    e.bb = {
      x0: Math.min(...pts.map((p) => p.x)),
      y0: Math.min(...pts.map((p) => p.y)),
      x1: Math.max(...pts.map((p) => p.x)),
      y1: Math.max(...pts.map((p) => p.y)),
    };
    map.edges.push(e);
    A.adj.push(e.id);
    B.adj.push(e.id);
    return e;
  };

  addEdge(baseNode, J[0][1], { startDir: [1, 0] });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) if (r === 1 || rnd.chance(0.78)) addEdge(J[c][r], J[c + 1][r]);
  }
  for (let c = 0; c < 4; c++) {
    for (const [r1, r2] of [[0, 1], [1, 2]]) if (rnd.chance(c === 0 ? 0.85 : 0.55)) addEdge(J[c][r1], J[c][r2], { jitter: 90 });
  }
  for (let r = 0; r < 3; r++) addEdge(J[3][r], opNodes[r], { endDir: [1, 0] });

  // Якщо якийсь вузол відірваний - з'єднуємо його з центральним рядом
  for (let guard = 0; guard < 6; guard++) {
    const ok = reachable(map, baseNode.id);
    let fixed = false;
    for (let c = 0; c < 4; c++) {
      for (const r of [0, 2]) {
        if (!ok[J[c][r].id]) {
          addEdge(J[c][r], J[c][1], { jitter: 90 });
          fixed = true;
        }
      }
    }
    if (!fixed) break;
  }

  // --- Річка між 2-ю і 3-ю колонами перехресть ---
  const st = { w: 50, step: 10, y0: -60, xs: [] };
  const sx0 = (colsX[1] + colsX[2]) / 2 + rnd.range(-80, 80);
  const a1 = rnd.range(90, 125);
  const p1 = rnd.range(1050, 1400);
  const ph1 = rnd.range(0, 6.28);
  const a2 = rnd.range(25, 40);
  const p2 = rnd.range(450, 620);
  const ph2 = rnd.range(0, 6.28);
  for (let y = st.y0; y <= H + 60; y += st.step) {
    st.xs.push(sx0 + a1 * Math.sin((y / p1) * Math.PI * 2 + ph1) + a2 * Math.sin((y / p2) * Math.PI * 2 + ph2));
  }
  map.stream = st;

  // Мости там, де дорога перетинає річку
  for (const e of map.edges) {
    let prev = 0;
    const cross = [];
    for (let i = 0; i < e.pts.length; i++) {
      const p = e.pts[i];
      const side = Math.sign(p.x - streamX(map, p.y));
      if (prev !== 0 && side !== 0 && side !== prev) cross.push(i);
      if (side !== 0) prev = side;
    }
    e.crossings = cross.length;
    for (const i of cross) {
      const p = e.pts[i];
      // Довжина мосту залежить від кута перетину: навскіс вода тягнеться довше
      const sl = (streamX(map, p.y + 5) - streamX(map, p.y - 5)) / 10;
      const sn = Math.hypot(sl, 1);
      const sin = Math.abs(p.tx * (1 / sn) - p.ty * (sl / sn));
      const len = (st.w + 50) / Math.max(0.4, sin);
      map.bridges.push({ x: p.x, y: p.y, a: Math.atan2(p.ty, p.tx), len, e: e.id, s: p.s, broken: false });
    }
  }
  // Один міст може бути зруйнований, якщо до всіх ОП лишається інший шлях
  if (rnd.chance(0.65)) {
    const cands = shuffle(map.bridges.filter((b) => map.edges[b.e].crossings === 1));
    for (const b of cands) {
      const e = map.edges[b.e];
      e.broken = true;
      const ok = reachable(map, baseNode.id);
      if (opNodes.every((o) => ok[o.id])) {
        b.broken = true;
        e.breakS = b.s;
        break;
      }
      e.broken = false;
    }
  }

  // --- Індекс доріг ---
  map.roadIdx = new Map();
  map.edges.forEach((e, ei) => {
    e.pts.forEach((p, pi) => {
      const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
      let arr = map.roadIdx.get(k);
      if (!arr) map.roadIdx.set(k, (arr = []));
      arr.push((ei << 16) | pi);
    });
  });
  const roadD = (x, y) => {
    const nr = nearestRoad(map, x, y, 480);
    return nr ? nr.d : 9999;
  };

  // --- База ---
  const base = { x: baseNode.x, y: baseNode.y, node: baseNode.id };
  const garage = { x: base.x - 100, y: base.y, w: 132, h: 94, a: 0, roofFrac: 0.26, gate: 0 };
  garage.park = { x: garage.x + 28, y: base.y };
  garage.stack = [
    { x: garage.x - 16, y: base.y - 7 },
    { x: garage.x - 16, y: base.y + 7 },
    { x: garage.x - 31, y: base.y - 7 },
    { x: garage.x - 31, y: base.y + 7 },
  ];
  garage.rest = [
    { x: garage.x - 40, y: base.y - 30 },
    { x: garage.x - 40, y: base.y + 30 },
  ];
  map.base = base;
  map.garage = garage;
  const baseClear = { x: garage.x + 20, y: base.y, w: garage.w + 110, h: garage.h + 50, a: 0 };

  // --- Опорні пункти ---
  const names = shuffle(CALLSIGNS.slice()).slice(0, 3);
  map.ops = opNodes.map((nd, k) => {
    const e = map.edges[nd.adj[0]];
    const end = e.pts[e.pts.length - 1];
    const ea = Math.atan2(end.ty, end.tx);
    const F = frame(nd.x, nd.y, ea);
    const op = { idx: k, node: nd.id, x: nd.x, y: nd.y, a: ea, name: names[k], status: 'ok' };
    op.capon = { ...F(56, 0), w: 90, h: 84, a: ea };
    op.net = { ...F(58, 0), w: 124, h: 116, a: ea, leaves: [] };
    for (let i = 0; i < 70; i++) {
      op.net.leaves.push({ lx: rnd.range(-58, 58), ly: rnd.range(-54, 54), r: rnd.range(4, 9), c: rnd.pick(NET_LEAVES), a: rnd.range(0, 3) });
    }
    op.dugout = { ...F(166, -80), w: 66, h: 46, a: ea + rnd.range(-0.15, 0.15) };
    op.dugEntry = F(124, -70);
    op.exit = F(116, -50);
    op.trench = [F(124, -70), F(116, -50), F(132, -26), F(146, -4), F(132, 20), F(148, 44), F(134, 68), F(150, 92)];
    op.posts = [F(146, -4), F(148, 44), F(150, 92)];
    op.bags = [];
    for (let i = 1; i < op.trench.length; i++) {
      const p = op.trench[i];
      op.bags.push({ x: p.x + Math.cos(ea) * 13, y: p.y + Math.sin(ea) * 13, a: ea + rnd.range(-0.3, 0.3) });
    }
    op.starlink = F(194, -30);
    op.defense = { ...F(90, 0), r: 270 };
    op.labelPt = F(56, -60);
    op.clear = { ...F(110, 0), w: 260, h: 250, a: ea };
    return op;
  });

  const blocked = (x, y, pad = 0) => inRotRect(x, y, baseClear, pad) || map.ops.some((op) => inRotRect(x, y, op.clear, pad));
  const free = (x, y, pad) =>
    x > 12 && x < W - 12 && y > 12 && y < H - 12 && !blocked(x, y, pad) && !inWater(map, x, y, pad + 10) && roadD(x, y) > HALF + pad;

  // Зона небезпеки: від тилу до лінії ОП
  map.dangerX0 = base.x + 900;
  map.dangerX1 = W - 700;

  // --- Поля ---
  for (let i = 0; i < 130; i++) {
    map.fields.push({ x: rnd.range(-100, W + 100), y: rnd.range(-100, H + 100), rx: rnd.range(140, 360), ry: rnd.range(90, 220), a: rnd.range(0, Math.PI), c: rnd.pick(FIELDS) });
  }
  for (let i = 0; i < 26; i++) {
    map.plowed.push({ x: rnd.range(500, W - 300), y: rnd.range(80, H - 80), w: rnd.range(340, 640), h: rnd.range(200, 360), a: rnd.range(-0.5, 0.5), c: rnd.pick(PLOWED) });
  }

  // --- Дерева. trunk - радіус стовбура: крізь нього не проїхати ---
  const trees = map.trees;
  const addTree = (x, y, r, trunk = 5, pad = 6) => {
    if (!free(x, y, pad)) return false;
    const pal = rnd.pick(CROWNS);
    trees.push({ x, y, r, trunk, c1: pal[0], c2: pal[1], hx: rnd.range(0.15, 0.3), hy: rnd.range(0.18, 0.32) });
    return true;
  };

  // --- Антидронові сітки над дорогою, з обох боків щільна посадка ---
  const nearBridge = (e, s0, s1, pad) => map.bridges.some((b) => b.e === e.id && b.s > s0 - pad && b.s < s1 + pad);
  const netCands = shuffle(map.edges.filter((e) => e.len > 1000 && e.pts[e.pts.length >> 1].x > W * 0.3));
  const wantNets = rnd.int(CFG.nets.count[0], CFG.nets.count[1]);
  for (const e of netCands) {
    if (map.nets.length >= wantNets) break;
    for (let tr = 0; tr < 5; tr++) {
      const Ln = rnd.range(300, 440);
      if (e.len - 520 - Ln < 0) break;
      const s0 = rnd.range(260, e.len - 260 - Ln);
      const s1 = s0 + Ln;
      if (nearBridge(e, s0, s1, 180)) continue;
      if (map.nets.some((n) => n.e === e.id && s0 < n.s1 + 300 && s1 > n.s0 - 300)) continue;
      const half = HALF + 10;
      const left = [];
      const right = [];
      const center = [];
      for (let u = s0; u <= s1; u += 8) {
        const p = roadAt(e, u);
        left.push({ x: p.x + p.nx * half, y: p.y + p.ny * half });
        right.push({ x: p.x - p.nx * half, y: p.y - p.ny * half });
        center.push({ x: p.x, y: p.y });
      }
      const poles = [];
      for (let u = s0; u <= s1 + 1; u += 40) {
        const p = roadAt(e, Math.min(u, s1));
        poles.push({ x: p.x + p.nx * half, y: p.y + p.ny * half }, { x: p.x - p.nx * half, y: p.y - p.ny * half });
      }
      const all = left.concat(right);
      const nt = {
        e: e.id,
        s0,
        s1,
        half,
        left,
        right,
        center,
        poles,
        holes: [],
        sags: [],
        bb: {
          x0: Math.min(...all.map((q) => q.x)),
          y0: Math.min(...all.map((q) => q.y)),
          x1: Math.max(...all.map((q) => q.x)),
          y1: Math.max(...all.map((q) => q.y)),
        },
      };
      // Провиси: місця, де сітка звисає низько - НРК може заплутатися
      const nSag = rnd.int(CFG.nets.sags[0], CFG.nets.sags[1]);
      for (let k = 0; k < nSag; k++) {
        const u = s0 + 50 + ((Ln - 100) * (k + rnd.range(0.15, 0.85))) / nSag;
        const lat = rnd.range(-HALF * 0.55, HALF * 0.55);
        const p = roadAt(e, u);
        nt.sags.push({ x: p.x + p.nx * lat, y: p.y + p.ny * lat, r: rnd.range(15, 20), a: rnd.range(0, Math.PI) });
      }
      map.nets.push(nt);
      break;
    }
  }
  for (const nt of map.nets) {
    const e = map.edges[nt.e];
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const off = HALF + 16 + row * 22;
        const shift = row % 2 ? 12 : 0;
        for (let u = nt.s0 - 80 + shift; u <= nt.s1 + 80; u += 24) {
          const p = roadAt(e, u);
          addTree(p.x + p.nx * off * side, p.y + p.ny * off * side, rnd.range(17, 23), 6, 8);
        }
      }
    }
  }
  const inNet = (e, s, pad) => map.nets.some((n) => n.e === e.id && s > n.s0 - pad && s < n.s1 + pad);

  // Посадки вздовж доріг
  for (const e of map.edges) {
    let s = 120;
    while (s < e.len - 120) {
      const len = rnd.range(240, 640);
      const side = rnd.chance(0.5) ? 1 : -1;
      const off = rnd.range(HALF + 55, HALF + 170) * side;
      for (let u = 0; u < len && s + u < e.len - 100; u += rnd.range(28, 40)) {
        if (inNet(e, s + u, 90)) continue;
        const p = roadAt(e, s + u);
        const o = off + rnd.range(-12, 12);
        addTree(p.x + p.nx * o, p.y + p.ny * o, rnd.range(18, 30), 5, 30);
        if (rnd.chance(0.35)) {
          const o2 = o + side * rnd.range(18, 30);
          addTree(p.x + p.nx * o2, p.y + p.ny * o2, rnd.range(16, 26), 5, 30);
        }
      }
      s += len + rnd.range(80, 300);
    }
  }

  // Острівці укриття: крони нависають над дорогою з обох боків
  for (const e of map.edges) {
    let s = 200 + rnd.range(0, 140);
    while (s < e.len - 200) {
      if (!inNet(e, s, 120) && !nearBridge(e, s, s, 120)) {
        const cnt = rnd.int(3, 5);
        let made = 0;
        for (let k = 0; k < cnt; k++) {
          const p = roadAt(e, s + rnd.range(-45, 45));
          const side = k % 2 === 0 ? 1 : -1;
          const o = side * (HALF + rnd.range(12, 20));
          if (addTree(p.x + p.nx * o, p.y + p.ny * o, rnd.range(38, 48), 6, 6)) made++;
          if (rnd.chance(0.5)) {
            const o2 = side * (HALF + rnd.range(46, 64));
            addTree(p.x + p.nx * o2, p.y + p.ny * o2, rnd.range(24, 32), 5, 20);
          }
        }
        const c = roadAt(e, s);
        if (made) map.covers.push({ x: c.x, y: c.y, e: e.id, s });
      }
      s += rnd.range(260, 420);
    }
  }

  // Лісові масиви подалі від доріг
  for (let i = 0, made = 0; i < 60 && made < 10; i++) {
    const cx = rnd.range(200, W - 200);
    const cy = rnd.range(150, H - 150);
    if (!free(cx, cy, 120)) continue;
    made++;
    const rx = rnd.range(140, 280);
    const ry = rnd.range(110, 220);
    const a = rnd.range(0, Math.PI);
    const n = Math.round((rx * ry) / 900);
    for (let k = 0; k < n; k++) {
      const u = Math.sqrt(rnd());
      const v = rnd.range(0, Math.PI * 2);
      const lx = rx * u * Math.cos(v);
      const ly = ry * u * Math.sin(v);
      addTree(cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a), rnd.range(20, 32), 5, 25);
    }
  }

  // --- Руїни: два села біля перехресть + поодинокі хати ---
  const addRuin = (x, y, w, h, a) => {
    if (!free(x, y, Math.max(w, h) * 0.55 + 6)) return false;
    if (map.ruins.some((o) => dist(o.x, o.y, x, y) < 95)) return false;
    const r = { x, y, w, h, a, rubble: [] };
    for (let k = 0; k < 6; k++) {
      r.rubble.push({ dx: rnd.range(-w * 0.8, w * 0.8), dy: rnd.range(-h * 0.8, h * 0.8), s: rnd.range(5, 11), a: rnd.range(0, 3) });
    }
    map.ruins.push(r);
    return true;
  };
  const villageNodes = shuffle(J.slice(0, 3).flat()).slice(0, 2);
  for (const vn of villageNodes) {
    for (let k = 0, made = 0; k < 50 && made < 8; k++) {
      const a = rnd.range(0, Math.PI * 2);
      const d = rnd.range(120, 280);
      const x = vn.x + Math.cos(a) * d;
      const y = vn.y + Math.sin(a) * d;
      const w = rnd.range(60, 96);
      const h = rnd.range(46, 70);
      if (addRuin(x, y, w, h, rnd.range(-0.4, 0.4))) {
        made++;
        // Город і паркан біля хати
        map.plowed.push({ x: x + rnd.range(-40, 40), y: y + rnd.range(-40, 40), w: rnd.range(70, 120), h: rnd.range(50, 90), a: rnd.range(-0.4, 0.4), c: rnd.pick(PLOWED) });
        const fa = rnd.range(0, Math.PI);
        const fl = rnd.range(50, 90);
        map.fences.push({ x1: x - Math.cos(fa) * fl, y1: y - Math.sin(fa) * fl + h * 0.8, x2: x + Math.cos(fa) * fl, y2: y + Math.sin(fa) * fl + h * 0.8 });
        for (let t = 0; t < 2; t++) addTree(x + rnd.range(-90, 90), y + rnd.range(-90, 90), rnd.range(18, 26), 5, 20);
      }
    }
    vn.village = true;
  }
  for (let k = 0, made = 0; k < 80 && made < 7; k++) {
    const e = rnd.pick(map.edges);
    const p = roadAt(e, rnd.range(150, e.len - 150));
    const side = rnd.chance(0.5) ? 1 : -1;
    const off = side * rnd.range(HALF + 55, HALF + 130);
    if (addRuin(p.x + p.nx * off, p.y + p.ny * off, rnd.range(60, 96), rnd.range(46, 70), rnd.range(-0.6, 0.6))) made++;
  }

  // Поодинокі дерева
  for (let i = 0, made = 0; i < 400 && made < 130; i++) {
    if (addTree(rnd.range(0, W), rnd.range(0, H), rnd.range(16, 28), 5, 40)) made++;
  }
  // Зелень біля бази й ОП
  for (let i = 0; i < 7; i++) addTree(garage.x + rnd.range(-70, 150), base.y - rnd.range(85, 150), rnd.range(20, 30));
  for (let i = 0; i < 7; i++) addTree(garage.x + rnd.range(-70, 150), base.y + rnd.range(85, 150), rnd.range(20, 30));
  for (const op of map.ops) {
    const F = frame(op.x, op.y, op.a);
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      const p = F(rnd.range(-10, 170), side * rnd.range(140, 190));
      addTree(p.x, p.y, rnd.range(22, 32));
    }
  }

  // --- Підбита техніка на узбіччях ---
  const WRECK_KINDS = [
    { kind: 'car', w: 44, h: 22 },
    { kind: 'truck', w: 62, h: 26 },
    { kind: 'apc', w: 56, h: 30 },
  ];
  for (let k = 0, made = 0; k < 80 && made < 6; k++) {
    const e = rnd.pick(map.edges);
    const s = rnd.range(220, e.len - 220);
    if (inNet(e, s, 150) || nearBridge(e, s, s, 160)) continue;
    const p = roadAt(e, s);
    if (map.covers.some((c) => c.e === e.id && Math.abs(c.s - s) < 140)) continue;
    const side = rnd.chance(0.5) ? 1 : -1;
    const t = rnd.pick(WRECK_KINDS);
    const off = side * (HALF - 2 + rnd.range(0, 14));
    const x = p.x + p.nx * off;
    const y = p.y + p.ny * off;
    if (blocked(x, y, 60) || map.wrecks.some((w) => dist(w.x, w.y, x, y) < 400)) continue;
    map.wrecks.push({ ...t, x, y, a: Math.atan2(p.ty, p.tx) + rnd.range(-0.5, 0.5), e: e.id, s });
    made++;
  }

  // --- Воронки й бруд ---
  for (let i = 0; i < 900 && map.craters.length < 300; i++) {
    const x = rnd.range(0, W);
    if (!rnd.chance(0.15 + 0.85 * clamp((x - map.dangerX0) / (map.dangerX1 - map.dangerX0), 0, 1))) continue;
    const y = rnd.range(0, H);
    if (blocked(x, y, 30) || inWater(map, x, y, 30)) continue;
    map.craters.push({ x, y, r: rnd.range(10, 24), water: rnd.chance(0.15), scorch: false });
  }
  for (const op of map.ops) {
    const F = frame(op.x, op.y, op.a);
    for (let i = 0; i < 14; i++) {
      const p = F(rnd.range(-320, 140), rnd.range(-260, 260));
      if (blocked(p.x, p.y, 30)) continue;
      map.craters.push({ x: p.x, y: p.y, r: rnd.range(10, 22), water: rnd.chance(0.2), scorch: false });
    }
  }
  for (let i = 0; i < 60 && map.mud.length < 26; i++) {
    const e = rnd.pick(map.edges);
    const s = rnd.range(150, e.len - 150);
    if (inNet(e, s, 60) || nearBridge(e, s, s, 120)) continue;
    const p = roadAt(e, s);
    map.mud.push({ x: p.x + p.nx * rnd.range(-12, 12), y: p.y + p.ny * rnd.range(-12, 12), rx: rnd.range(32, 56), ry: rnd.range(18, 28), a: Math.atan2(p.ty, p.tx) });
  }

  // --- Міни на дорогах і узбіччях ---
  const want = rnd.int(CFG.mines.road[0], CFG.mines.road[1]);
  for (let tries = 0; tries < 3000 && map.mines.length < want; tries++) {
    const e = rnd.pick(map.edges);
    const s = rnd.range(150, e.len - 150);
    const p = roadAt(e, s);
    if (clamp((p.x - map.dangerX0) / (map.dangerX1 - map.dangerX0), 0, 1) < 0.12) continue;
    if (inNet(e, s, 40) || nearBridge(e, s, s, 140)) continue;
    if (map.covers.some((c) => c.e === e.id && Math.abs(c.s - s) < 100)) continue;
    if (map.nodes.some((n) => n.kind !== 'op' && dist(n.x, n.y, p.x, p.y) < 130)) continue;
    const onRoad = rnd.chance(0.6);
    const off = onRoad ? rnd.range(-20, 20) : (rnd.chance(0.5) ? 1 : -1) * rnd.range(HALF + 8, HALF + 34);
    const mx = p.x + p.nx * off;
    const my = p.y + p.ny * off;
    if (map.mines.some((m) => dist(m.x, m.y, mx, my) < 170)) continue;
    if (map.wrecks.some((w) => dist(w.x, w.y, mx, my) < 90)) continue;
    if (blocked(mx, my, 160)) continue;
    map.mines.push({ x: mx, y: my, known: rnd.chance(CFG.mines.known), alive: true, ha: rnd.range(0, Math.PI), field: false });
  }

  // --- Мінні поля обабіч доріг, позначені червоними знаками ---
  for (let tries = 0; tries < 300 && map.minefields.length < 10; tries++) {
    const e = rnd.pick(map.edges);
    const p = roadAt(e, rnd.range(200, e.len - 200));
    if (p.x < map.dangerX0 - 200) continue;
    const side = rnd.chance(0.5) ? 1 : -1;
    const ry = rnd.range(70, 110);
    const off = side * rnd.range(ry + HALF + 70, ry + HALF + 170);
    const cx = p.x + p.nx * off;
    const cy = p.y + p.ny * off;
    const rx = rnd.range(130, 200);
    const a = Math.atan2(p.ty, p.tx);
    if (cx < rx || cx > W - rx || cy < 80 || cy > H - 80) continue;
    if (map.minefields.some((m) => dist(m.x, m.y, cx, cy) < 420)) continue;
    if (blocked(cx, cy, 220) || roadD(cx, cy) < ry + HALF + 30 || inWater(map, cx, cy, rx)) continue;
    const mf = { x: cx, y: cy, rx, ry, a, signs: [] };
    const G = frame(cx, cy, a);
    const phi = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    for (let k = -3; k <= 3; k++) {
      const th = phi + k * 0.42;
      mf.signs.push(G(rx * Math.cos(th), ry * Math.sin(th)));
    }
    const cnt = rnd.int(6, 9);
    for (let k = 0; k < cnt; k++) {
      const u = Math.sqrt(rnd());
      const v = rnd.range(0, Math.PI * 2);
      const q = G(rx * 0.85 * u * Math.cos(v), ry * 0.85 * u * Math.sin(v));
      if (roadD(q.x, q.y) < HALF + 50) continue;
      map.mines.push({ x: q.x, y: q.y, known: false, alive: true, ha: rnd.range(0, Math.PI), field: true });
    }
    map.minefields.push(mf);
  }

  // --- Зони ворожого РЕБ ---
  for (let tries = 0; tries < 300 && map.rebZones.length < CFG.rebZones; tries++) {
    const e = rnd.pick(map.edges);
    const p = roadAt(e, rnd.range(100, e.len - 100));
    const dng = clamp((p.x - map.dangerX0) / (map.dangerX1 - map.dangerX0), 0, 1);
    if (dng < 0.2 || dng > 0.85) continue;
    const o = rnd.range(-120, 120);
    const z = { x: p.x + p.nx * o, y: p.y + p.ny * o, r: rnd.range(240, 320) };
    if (map.rebZones.some((q) => dist(q.x, q.y, z.x, z.y) < 800)) continue;
    map.rebZones.push(z);
  }

  map.grid = { x0: rnd.int(2000, 7000), y0: rnd.int(3000, 8000) };

  // Індекс дерев для швидких зіткнень і перевірки укриття
  map.treeGrid = new Map();
  trees.forEach((t, i) => {
    const k = key(Math.floor(t.x / TCELL), Math.floor(t.y / TCELL));
    let arr = map.treeGrid.get(k);
    if (!arr) map.treeGrid.set(k, (arr = []));
    arr.push(i);
  });

  // Ціль і запасна ціль - від сиду: у друзів однакові. Чи зміниться завдання - кидається в кожному рейсі
  const sr = makeRng(seed ^ 0x5bd1e995);
  const first = Math.floor(sr() * 3);
  let next = Math.floor(sr() * 2);
  if (next >= first) next++;
  map.scenario = { first, next };

  return map;
}
