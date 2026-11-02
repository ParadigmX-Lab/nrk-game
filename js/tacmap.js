import { CFG } from './config.js';
import { gridCoord } from './map.js';
import { bearingDeg, bearingName } from './util.js';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const GRID = 500; // крок сітки у світових пікселях (125 м)

function arrow(ctx, x, y, a, size, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.65);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.7, size * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function polyline(ctx, P, pts, step = 1, from = 0, to = Infinity) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (p.s !== undefined && (p.s < from || p.s > to)) continue;
    const [x, y] = P(p.x, p.y);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
}

function streamPath(ctx, m, P, y0 = -Infinity, y1 = Infinity) {
  const st = m.stream;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < st.xs.length; i += 2) {
    const wy = st.y0 + i * st.step;
    if (wy < y0 || wy > y1) continue;
    const [x, y] = P(st.xs[i], wy);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
}

// ---------- Мінікарта: квадрат навколо НРК, північ угорі ----------
export function drawMinimap(ctx, g, w, h) {
  const m = g.map;
  const r = g.robot;
  const span = 2600;
  const s = w / span;
  const P = (x, y) => [w / 2 + (x - r.x) * s, h / 2 + (y - r.y) * s];
  const x0 = r.x - span / 2;
  const x1 = r.x + span / 2;
  const y0 = r.y - h / 2 / s;
  const y1 = r.y + h / 2 / s;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(170,110,240,0.25)';
  for (const z of m.rebZones) {
    const [x, y] = P(z.x, z.y);
    ctx.beginPath();
    ctx.arc(x, y, z.r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(230,60,50,0.45)';
  for (const mf of m.minefields) {
    const [x, y] = P(mf.x, mf.y);
    ctx.beginPath();
    ctx.ellipse(x, y, mf.rx * s, mf.ry * s, mf.a, 0, Math.PI * 2);
    ctx.fill();
  }
  streamPath(ctx, m, P, y0 - 50, y1 + 50);
  ctx.strokeStyle = '#4F93B5';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#CDA66C';
  ctx.lineWidth = 1.6;
  for (const e of m.edges) {
    if (e.bb.x1 < x0 || e.bb.x0 > x1 || e.bb.y1 < y0 || e.bb.y0 > y1) continue;
    polyline(ctx, P, e.pts, 4);
    ctx.stroke();
  }
  ctx.strokeStyle = '#7FD8E8';
  ctx.lineWidth = 3;
  for (const nt of m.nets) {
    polyline(ctx, P, m.edges[nt.e].pts, 2, nt.s0, nt.s1);
    ctx.stroke();
  }
  for (const b of m.bridges) {
    if (!b.broken) continue;
    const [x, y] = P(b.x, b.y);
    ctx.strokeStyle = '#FF5A4E';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 3);
    ctx.lineTo(x + 3, y + 3);
    ctx.moveTo(x + 3, y - 3);
    ctx.lineTo(x - 3, y + 3);
    ctx.stroke();
  }
  if (g.route && g.route.pts.length > 1) {
    ctx.strokeStyle = g.task.next !== null && g.phase === 'outbound' ? 'rgba(255,190,60,0.95)' : 'rgba(139,242,138,0.95)';
    ctx.lineWidth = 2.6;
    polyline(ctx, P, g.route.pts, 3);
    ctx.stroke();
  }
  ctx.fillStyle = '#FF5A4E';
  for (const mi of m.mines) {
    if (!mi.alive || !mi.known) continue;
    const [x, y] = P(mi.x, mi.y);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  const toBase = g.phase === 'return' || g.phase === 'parking';
  const targets = [[m.base, toBase ? '#8BF28A' : 'rgba(139,242,138,0.5)']];
  for (const op of m.ops) {
    const col = op.status === 'fire' ? '#FF5A4E' : !toBase && op.idx === g.task.op ? '#8BF28A' : 'rgba(220,230,210,0.55)';
    targets.push([op.capon, col]);
  }
  for (const [pt, col] of targets) {
    const [x, y] = P(pt.x, pt.y);
    const cx = Math.max(4, Math.min(w - 4, x));
    const cy = Math.max(4, Math.min(h - 4, y));
    ctx.fillStyle = col;
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
  }
  for (const f of g.fpv.list) {
    if (f.state === 'wait') {
      if (!f.known) continue;
      const [x, y] = P(f.x, f.y);
      ctx.strokeStyle = '#FF7A1A';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
      continue;
    }
    if (Math.hypot(f.x - r.x, f.y - r.y) > g.fpv.range(f)) continue;
    const [x, y] = P(f.x, f.y);
    ctx.fillStyle = f.bomber ? '#FFD24A' : '#FF7A1A';
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  arrow(ctx, w / 2, h / 2, r.a, 6, '#FFFFFF');
}

// ---------- Тактична карта ----------
function worldBox(m) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of m.edges) {
    x0 = Math.min(x0, e.bb.x0);
    y0 = Math.min(y0, e.bb.y0);
    x1 = Math.max(x1, e.bb.x1);
    y1 = Math.max(y1, e.bb.y1);
  }
  const pad = 300;
  return { x0: Math.max(0, Math.min(x0, m.garage.x) - pad), y0: Math.max(0, y0 - pad), x1: Math.min(m.W, x1 + pad), y1: Math.min(m.H, y1 + pad) };
}

// view: { full: true } - весь район; інакше { cx, cy, span } - фрагмент навколо точки (span - ширина у світових px)
export function tacticalTransform(g, w, h, view) {
  const box = worldBox(g.map);
  const pad = 26;
  let s;
  let cx;
  let cy;
  if (!view || view.full) {
    s = Math.min((w - pad * 2) / (box.x1 - box.x0), (h - pad * 2) / (box.y1 - box.y0));
    cx = (box.x0 + box.x1) / 2;
    cy = (box.y0 + box.y1) / 2;
  } else {
    s = (w - pad * 2) / view.span;
    const hw = w / 2 / s;
    const hh = h / 2 / s;
    cx = Math.max(box.x0 + hw - pad / s, Math.min(box.x1 - hw + pad / s, view.cx));
    cy = Math.max(box.y0 + hh - pad / s, Math.min(box.y1 - hh + pad / s, view.cy));
    if (box.x1 - box.x0 < hw * 2) cx = (box.x0 + box.x1) / 2;
    if (box.y1 - box.y0 < hh * 2) cy = (box.y0 + box.y1) / 2;
    view.cx = cx;
    view.cy = cy;
  }
  return { box, s, offx: w / 2 - cx * s, offy: h / 2 - cy * s };
}

export function drawTactical(ctx, g, w, h, view) {
  const m = g.map;
  const r = g.robot;
  const { box, s, offx, offy } = tacticalTransform(g, w, h, view);
  const P = (x, y) => [offx + x * s, offy + y * s];
  const [bx0, by0] = P(box.x0, box.y0);
  const [bx1, by1] = P(box.x1, box.y1);
  const x0 = Math.max(bx0, 4);
  const y0 = Math.max(by0, 18);
  const x1 = Math.min(bx1, w - 4);
  const y1 = Math.min(by1, h - 4);

  ctx.fillStyle = '#141C13';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1F2B1C';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // Координатна сітка
  const vx0 = (x0 - offx) / s;
  const vx1 = (x1 - offx) / s;
  const vy0 = (y0 - offy) / s;
  const vy1 = (y1 - offy) / s;
  ctx.strokeStyle = 'rgba(200,230,190,0.12)';
  ctx.lineWidth = 1;
  ctx.font = `500 9px ${MONO}`;
  ctx.fillStyle = 'rgba(200,230,190,0.6)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const step = s * GRID < 40 ? GRID * 2 : GRID;
  for (let gx = Math.ceil(vx0 / step) * step; gx <= vx1; gx += step) {
    const [x] = P(gx, 0);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillText(String(gridCoord(m, gx, 0).X), x, y0 - 3);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let gy = Math.ceil(vy0 / step) * step; gy <= vy1; gy += step) {
    const [, y] = P(0, gy);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillText(String(gridCoord(m, 0, gy).Y), x0 + 3, y + 2);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();

  const inV = (x, y, pad) => x + pad > vx0 && x - pad < vx1 && y + pad > vy0 && y - pad < vy1;

  // Дерева й руїни - потенційні укриття
  ctx.fillStyle = 'rgba(80,150,70,0.55)';
  for (const t of m.trees) {
    if (!inV(t.x, t.y, t.r)) continue;
    const [x, y] = P(t.x, t.y);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, t.r * s * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(190,185,170,0.6)';
  for (const ru of m.ruins) {
    if (!inV(ru.x, ru.y, 80)) continue;
    const [x, y] = P(ru.x, ru.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ru.a);
    ctx.fillRect((-ru.w * s) / 2, (-ru.h * s) / 2, Math.max(2, ru.w * s), Math.max(2, ru.h * s));
    ctx.restore();
  }

  // Підпис тримається в межах карти, щоб не обрізався біля краю
  const label = (text, x, y, color, bg) => {
    ctx.font = `700 10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width + 8;
    const lx = Math.max(x0 + tw / 2 + 2, Math.min(x1 - tw / 2 - 2, x));
    const ly = Math.max(y0 + 9, Math.min(y1 - 9, y));
    ctx.fillStyle = bg || 'rgba(12,18,14,0.78)';
    ctx.fillRect(lx - tw / 2, ly - 7, tw, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, lx, ly);
  };

  streamPath(ctx, m, P);
  ctx.strokeStyle = '#3E7FA0';
  ctx.lineWidth = Math.max(2, m.stream.w * s);
  ctx.stroke();

  for (const z of m.rebZones) {
    const [x, y] = P(z.x, z.y);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(200,140,255,0.8)';
    ctx.fillStyle = 'rgba(170,110,240,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, z.r * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    label('РЕБ', x, y - z.r * s + 9, '#D9B8FF');
  }

  for (const mf of m.minefields) {
    const [x, y] = P(mf.x, mf.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(mf.a);
    ctx.beginPath();
    ctx.ellipse(0, 0, mf.rx * s, mf.ry * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(230,60,50,0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,90,78,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.clip();
    ctx.beginPath();
    for (let d = -mf.rx * s * 2; d < mf.rx * s * 2; d += 5) {
      ctx.moveTo(d, -mf.ry * s);
      ctx.lineTo(d + mf.ry * s * 2, mf.ry * s);
    }
    ctx.strokeStyle = 'rgba(255,90,78,0.35)';
    ctx.stroke();
    ctx.restore();
    if (mf.rx * s > 20) label('МІНИ', x, y, '#FF8A80');
  }

  // Дороги
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#CDA66C';
  ctx.lineWidth = Math.max(2.5, CFG.road.width * s * 0.6);
  for (const e of m.edges) {
    polyline(ctx, P, e.pts, 2);
    ctx.stroke();
  }
  for (const nt of m.nets) {
    const e = m.edges[nt.e];
    polyline(ctx, P, e.pts, 1, nt.s0, nt.s1);
    ctx.strokeStyle = '#7FD8E8';
    ctx.lineWidth = Math.max(5, CFG.road.width * s);
    ctx.stroke();
    const mid = e.pts.find((p) => p.s >= (nt.s0 + nt.s1) / 2);
    const [x, y] = P(mid.x, mid.y);
    label('СІТКА', x, y - 13, '#BFF3FA');
  }
  for (const b of m.bridges) {
    const [x, y] = P(b.x, b.y);
    if (b.broken) {
      ctx.strokeStyle = '#FF5A4E';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x - 6, y + 6);
      ctx.stroke();
      label('МІСТ ЗРУЙНОВАНО', x, y + 16, '#FF8A80');
    } else {
      ctx.fillStyle = '#8B6B45';
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
  }
  for (const n of m.nodes) {
    if (!n.village) continue;
    const [x, y] = P(n.x, n.y);
    label('СЕЛО (РУЇНИ)', x, y + 18, 'rgba(230,225,210,0.85)');
  }

  // Маршрут до цілі
  if (g.route && g.route.pts.length > 1) {
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = '#8BF28A';
    ctx.lineWidth = 3;
    polyline(ctx, P, g.route.pts, 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Пройдений шлях
  if (g.trail.length > 1) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    g.trail.forEach((p, i) => {
      const [x, y] = P(p.x, p.y);
      if (i === 0 || p.gap) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = '#FF5A4E';
  ctx.lineWidth = 1.6;
  for (const mi of m.mines) {
    if (!mi.alive || !mi.known) continue;
    const [x, y] = P(mi.x, mi.y);
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 3);
    ctx.lineTo(x + 3, y + 3);
    ctx.moveTo(x + 3, y - 3);
    ctx.lineTo(x - 3, y + 3);
    ctx.stroke();
  }

  // База і опорні пункти
  const toBase = g.phase === 'return' || g.phase === 'parking';
  {
    const [x, y] = P(m.garage.x, m.garage.y);
    ctx.fillStyle = '#8BF28A';
    ctx.fillRect(x - 5, y - 5, 10, 10);
    label('БАЗА', x, y - 15, '#8BF28A', toBase ? 'rgba(30,122,76,0.9)' : undefined);
  }
  for (const op of m.ops) {
    const [x, y] = P(op.capon.x, op.capon.y);
    const isTarget = !toBase && op.idx === g.task.op;
    const fire = op.status === 'fire';
    const col = fire ? '#FF8A80' : isTarget ? '#8BF28A' : 'rgba(220,230,210,0.8)';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 6);
    ctx.lineTo(x - 4, y - 8);
    ctx.lineTo(x + 6, y - 4);
    ctx.lineTo(x - 4, y);
    ctx.fill();
    if (fire) {
      ctx.strokeStyle = 'rgba(255,90,78,0.8)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(12, 160 * s), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const text = `ОП «${op.name}»${fire ? ' · ОБСТРІЛ' : isTarget ? ' · ЦІЛЬ' : ''}`;
    label(text, x, y - 17, col, isTarget ? 'rgba(30,122,76,0.9)' : fire ? 'rgba(120,20,16,0.9)' : undefined);
  }

  for (const f of g.fpv.list) {
    if (f.state === 'wait') {
      if (!f.known) continue;
      const [x, y] = P(f.x, f.y);
      ctx.strokeStyle = '#FF7A1A';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 4, y - 4, 8, 8);
      continue;
    }
    if (Math.hypot(f.x - r.x, f.y - r.y) > g.fpv.range(f)) continue;
    const [x, y] = P(f.x, f.y);
    ctx.fillStyle = f.bomber ? '#FFD24A' : '#FF7A1A';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const [rx, ry] = P(r.x, r.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(rx, ry, 11, 0, Math.PI * 2);
  ctx.stroke();
  arrow(ctx, rx, ry, r.a, 8, '#FFFFFF');
  label('НРК', rx, ry + 18, '#FFFFFF');
  ctx.restore();
}

export function tacticalInfo(g) {
  const m = g.map;
  const r = g.robot;
  const sq = `${String(Math.floor(r.x / GRID) + 1).padStart(2, '0')}-${String(Math.floor(r.y / GRID) + 1).padStart(2, '0')}`;
  const toBase = g.phase === 'return' || g.phase === 'parking';
  const pts = [
    { name: 'НРК', x: r.x, y: r.y, self: true },
    { name: 'БАЗА', x: m.garage.x, y: m.garage.y, cls: toBase ? 'target' : '' },
    ...m.ops.map((op) => ({
      name: `ОП «${op.name}»`,
      x: op.capon.x,
      y: op.capon.y,
      cls: op.status === 'fire' ? 'fire' : !toBase && op.idx === g.task.op ? 'target' : '',
    })),
  ];
  const rows = pts.map((p) => {
    const c = gridCoord(m, p.x, p.y);
    const d = Math.round((Math.hypot(p.x - r.x, p.y - r.y) * CFG.metersPerPx) / 10) * 10;
    return {
      name: p.name,
      X: c.X,
      Y: c.Y,
      dist: p.self ? '-' : `${d} м ${bearingName(bearingDeg(p.x - r.x, p.y - r.y))}`,
      cls: p.self ? 'self' : p.cls,
    };
  });
  return { sq, rows };
}
