import { CFG } from './config.js';
import { clamp, roundRectPath, dist } from './util.js';
import { CROWNS as TREE_PALETTES } from './map.js';

function makeNoise(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.floor(Math.random() * 255);
  }
  x.putImageData(img, 0, 0);
  return c;
}

function makeScanlines() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 3;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 4, 1);
  return c;
}

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.noisePat = this.ctx.createPattern(makeNoise(128), 'repeat');
    this.scanPat = this.ctx.createPattern(makeScanlines(), 'repeat');
    this.cam = { x: 0, y: 0, init: false };
    this.dprCap = CFG.maxDpr; // знижується автоматично на слабких телефонах
    this.time = 0;
    this.cracks = [];
    for (let i = 0; i < 7; i++) this.cracks.push({ a: Math.random() * Math.PI * 2, l: 0.15 + Math.random() * 0.35, k: Math.random() * 0.6 - 0.3 });
    this.resize();
  }

  resize() {
    const p = this.canvas.parentElement;
    const w = p.clientWidth;
    const h = p.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.cw = w;
    this.ch = h;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.scale = h / CFG.viewH;
    this.vignette = null;
  }

  snapCamera() {
    this.cam.init = false;
  }

  updateCamera(g, dt) {
    const r = g.robot;
    const halfW = this.cw / this.scale / 2;
    const halfH = this.ch / this.scale / 2;
    // Випередження за згладженою швидкістю: миттєва шумить при зіткненнях і стрибках кадрів
    const kv = 1 - Math.exp(-dt * 4);
    this.cam.vx = (this.cam.vx || 0) + (r.vx - (this.cam.vx || 0)) * kv;
    this.cam.vy = (this.cam.vy || 0) + (r.vy - (this.cam.vy || 0)) * kv;
    let tx = r.x + this.cam.vx * 0.7;
    let ty = r.y + this.cam.vy * 0.5;
    tx = clamp(tx, Math.min(halfW, g.map.W / 2), Math.max(g.map.W - halfW, g.map.W / 2));
    ty = clamp(ty, Math.min(halfH, g.map.H / 2), Math.max(g.map.H - halfH, g.map.H / 2));
    if (!this.cam.init) {
      this.cam.x = tx;
      this.cam.y = ty;
      this.cam.vx = 0;
      this.cam.vy = 0;
      this.cam.init = true;
    } else {
      const k = 1 - Math.exp(-dt * 3);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
  }

  toScreen(x, y) {
    return { x: x * this.scale + this.ox, y: y * this.scale + this.oy };
  }

  render(g, dt) {
    if (!g.map || !g.robot) return;
    this.time += dt;
    const ctx = this.ctx;
    const s = this.scale;
    const dpr = this.dpr;
    this.updateCamera(g, dt);

    let sx = 0;
    let sy = 0;
    if (g.shake > 0) {
      sx = (Math.random() * 2 - 1) * g.shake;
      sy = (Math.random() * 2 - 1) * g.shake;
    }
    this.ox = this.cw / 2 - this.cam.x * s + sx;
    this.oy = this.ch / 2 - this.cam.y * s + sy;
    const v = {
      x0: -this.ox / s - 80,
      y0: -this.oy / s - 80,
      x1: (this.cw - this.ox) / s + 80,
      y1: (this.ch - this.oy) / s + 80,
    };
    const inView = (x, y, m) => x + m > v.x0 && x - m < v.x1 && y + m > v.y0 && y - m < v.y1;

    // ---------- Відео з ретранслятора ----------
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.ox, dpr * this.oy);
    this.drawGround(ctx, g, v, inView);
    this.drawStream(ctx, g, v);
    this.drawRoad(ctx, g, v);
    this.drawBridges(ctx, g, inView);
    this.drawMud(ctx, g, inView);
    this.drawTrail(ctx, g, v);
    this.drawCraters(ctx, g, inView);
    this.drawMineHints(ctx, g, inView);
    this.drawAmbush(ctx, g, inView);
    this.drawMinefields(ctx, g, inView);
    this.drawFences(ctx, g, inView);
    this.drawOpGround(ctx, g, inView);
    this.drawGarageFloor(ctx, g, inView);
    this.drawRuinsFloor(ctx, g, inView);
    this.drawWrecks(ctx, g, inView);
    this.drawTreeShadows(ctx, g, inView);
    this.drawVehicles(ctx, g, inView);
    this.drawRobot(ctx, g.robot);
    this.drawCrew(ctx, g, inView);
    this.drawRuinsTop(ctx, g, inView);
    this.drawGarageTop(ctx, g, inView);
    this.drawOpNet(ctx, g, inView);
    this.drawNets(ctx, g, inView);
    g.fx.draw(ctx);
    this.drawCrowns(ctx, g, inView);
    this.drawDrops(ctx, g, inView);
    for (const f of g.fpv.list) if (f.state !== 'wait' && inView(f.x, f.y, 80)) this.drawFpv(ctx, f);
    this.drawTracers(ctx, g);

    // ---------- Деградація відео ----------
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSignalFx(ctx, g);

    // ---------- Доповнена реальність (не деградує) ----------
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.ox, dpr * this.oy);
    this.drawAR(ctx, g, inView);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawARScreen(ctx, g);
  }

  // ---------- Сцена ----------
  drawGround(ctx, g, v, inView) {
    const m = g.map;
    ctx.fillStyle = '#86AE4F';
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    for (const f of m.fields) {
      if (!inView(f.x, f.y, f.rx)) continue;
      ctx.fillStyle = f.c;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.rx, f.ry, f.a, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of m.plowed) {
      if (!inView(p.x, p.y, Math.max(p.w, p.h))) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.fillStyle = 'rgba(70,80,25,0.14)';
      for (let x = -p.w / 2; x < p.w / 2; x += 15) ctx.fillRect(x, -p.h / 2, 5, p.h);
      ctx.restore();
    }
    // Край світу
    ctx.fillStyle = '#5F7D3A';
    if (v.x0 < 0) ctx.fillRect(v.x0, v.y0, -v.x0, v.y1 - v.y0);
    if (v.y0 < 0) ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, -v.y0);
    if (v.x1 > m.W) ctx.fillRect(m.W, v.y0, v.x1 - m.W, v.y1 - v.y0);
    if (v.y1 > m.H) ctx.fillRect(v.x0, m.H, v.x1 - v.x0, v.y1 - m.H);
  }

  drawStream(ctx, g, v) {
    const st = g.map.stream;
    if (!st) return;
    const i0 = clamp(Math.floor((v.y0 - st.y0) / st.step) - 3, 0, st.xs.length - 1);
    const i1 = clamp(Math.ceil((v.y1 - st.y0) / st.step) + 3, 0, st.xs.length - 1);
    let minx = Infinity;
    let maxx = -Infinity;
    for (let i = i0; i <= i1; i++) {
      minx = Math.min(minx, st.xs[i]);
      maxx = Math.max(maxx, st.xs[i]);
    }
    if (maxx + 80 < v.x0 || minx - 80 > v.x1) return;
    const path = () => {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const x = st.xs[i];
        const y = st.y0 + i * st.step;
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    path();
    ctx.strokeStyle = '#5E7F35';
    ctx.lineWidth = st.w + 30;
    ctx.stroke();
    ctx.strokeStyle = '#8A7A52';
    ctx.lineWidth = st.w + 10;
    ctx.stroke();
    ctx.strokeStyle = '#4F93B5';
    ctx.lineWidth = st.w;
    ctx.stroke();
    // Пунктир течії: зсув рахуємо від початку річки, а не від краю екрана - інакше він стрибає
    if (!st.cum) {
      st.cum = new Float64Array(st.xs.length);
      for (let i = 1; i < st.xs.length; i++) st.cum[i] = st.cum[i - 1] + Math.hypot(st.xs[i] - st.xs[i - 1], st.step);
    }
    ctx.strokeStyle = 'rgba(170,220,240,0.45)';
    ctx.lineWidth = st.w * 0.3;
    ctx.setLineDash([18, 26]);
    ctx.lineDashOffset = st.cum[i0] - this.time * 14;
    ctx.stroke();
    ctx.setLineDash([]);
    // Очерет по берегах: тільки кожна третя точка річки, незалежно від того, звідки починається видима частина
    ctx.fillStyle = 'rgba(70,100,40,0.8)';
    for (let i = i0 + ((3 - (i0 % 3)) % 3); i <= i1; i += 3) {
      const x = st.xs[i];
      const y = st.y0 + i * st.step;
      const side = i % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.arc(x + side * (st.w / 2 + 6), y, 3 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRoad(ctx, g, v) {
    const m = g.map;
    const W = CFG.road.width;
    const vis = [];
    for (const e of m.edges) {
      if (e.bb.x1 + 80 > v.x0 && e.bb.x0 - 80 < v.x1 && e.bb.y1 + 80 > v.y0 && e.bb.y0 - 80 < v.y1) vis.push(e);
    }
    if (!vis.length) return;
    const X0 = v.x0 - 90;
    const X1 = v.x1 + 90;
    const Y0 = v.y0 - 90;
    const Y1 = v.y1 + 90;
    const all = (off) => {
      ctx.beginPath();
      for (const e of vis) {
        let pen = false;
        for (const p of e.pts) {
          if (p.x < X0 || p.x > X1 || p.y < Y0 || p.y > Y1) {
            pen = false;
            continue;
          }
          const x = p.x + p.nx * off;
          const y = p.y + p.ny * off;
          if (pen) ctx.lineTo(x, y);
          else {
            ctx.moveTo(x, y);
            pen = true;
          }
        }
      }
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    all(0);
    ctx.strokeStyle = 'rgba(140,105,60,0.45)';
    ctx.lineWidth = W + 10;
    ctx.stroke();
    ctx.strokeStyle = '#CDA66C';
    ctx.lineWidth = W;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,150,70,0.32)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = '#CDA66C';
    for (const n of m.nodes) {
      if (n.kind !== 'junction' || n.x < X0 || n.x > X1 || n.y < Y0 || n.y > Y1) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, W / 2 + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120,88,48,0.3)';
    ctx.lineWidth = 5;
    all(-20);
    ctx.stroke();
    all(20);
    ctx.stroke();
  }

  drawBridges(ctx, g, inView) {
    const st = g.map.stream;
    for (const b of g.map.bridges) {
      if (!inView(b.x, b.y, b.len)) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      const L = b.len;
      const Wd = CFG.road.width + 8;
      if (!b.broken) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(-L / 2 + 5, -Wd / 2 + 7, L, Wd);
        ctx.fillStyle = '#8B6B45';
        ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
        ctx.strokeStyle = 'rgba(60,40,20,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = -L / 2 + 4; x < L / 2; x += 7) {
          ctx.moveTo(x, -Wd / 2 + 1);
          ctx.lineTo(x, Wd / 2 - 1);
        }
        ctx.stroke();
        ctx.fillStyle = '#5E4630';
        ctx.fillRect(-L / 2, -Wd / 2 - 3, L, 5);
        ctx.fillRect(-L / 2, Wd / 2 - 2, L, 5);
      } else {
        // Зруйнований міст: вода замість настилу, уламки
        const gap = Math.max(st.w + 10, L - 34);
        ctx.fillStyle = '#8A7A52';
        ctx.fillRect(-gap / 2 - 6, -Wd / 2 - 4, gap + 12, Wd + 8);
        ctx.fillStyle = '#4F93B5';
        ctx.fillRect(-gap / 2, -Wd / 2 - 4, gap, Wd + 8);
        ctx.fillStyle = '#7A5C3A';
        ctx.beginPath();
        ctx.moveTo(-L / 2, -Wd / 2);
        ctx.lineTo(-gap / 2 + 4, -Wd / 2);
        ctx.lineTo(-gap / 2 - 6, -Wd / 4);
        ctx.lineTo(-gap / 2 + 2, Wd / 6);
        ctx.lineTo(-gap / 2 - 4, Wd / 2);
        ctx.lineTo(-L / 2, Wd / 2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(L / 2, -Wd / 2);
        ctx.lineTo(gap / 2 + 2, -Wd / 2);
        ctx.lineTo(gap / 2 - 4, -Wd / 5);
        ctx.lineTo(gap / 2 + 6, Wd / 4);
        ctx.lineTo(gap / 2 - 2, Wd / 2);
        ctx.lineTo(L / 2, Wd / 2);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.translate(-4, 6);
        ctx.rotate(0.5);
        ctx.fillStyle = 'rgba(90,65,40,0.85)';
        ctx.fillRect(-14, -4, 28, 8);
        ctx.restore();
        ctx.save();
        ctx.translate(8, -14);
        ctx.rotate(-0.8);
        ctx.fillStyle = 'rgba(90,65,40,0.75)';
        ctx.fillRect(-10, -3, 20, 6);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawFences(ctx, g, inView) {
    ctx.strokeStyle = 'rgba(95,75,50,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const f of g.map.fences) {
      if (!inView((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, 100)) continue;
      ctx.moveTo(f.x1, f.y1);
      ctx.lineTo(f.x2, f.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawWrecks(ctx, g, inView) {
    for (const w of g.map.wrecks) {
      if (!inView(w.x, w.y, 70)) continue;
      ctx.fillStyle = 'rgba(30,25,20,0.32)';
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, w.w * 0.85, w.h * 1.1, w.a, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.a);
      const hw = w.w / 2;
      const hh = w.h / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-hw + 4, -hh + 5, w.w, w.h);
      if (w.kind === 'apc') {
        ctx.fillStyle = '#2A2622';
        ctx.fillRect(-hw, -hh - 3, w.w, 7);
        ctx.fillRect(-hw, hh - 4, w.w, 7);
      } else {
        ctx.fillStyle = '#1E1C1A';
        for (const sx of [-hw * 0.6, hw * 0.55]) {
          ctx.fillRect(sx - 5, -hh - 2, 10, 5);
          ctx.fillRect(sx - 5, hh - 3, 10, 5);
        }
      }
      ctx.fillStyle = '#4A4038';
      roundRectPath(ctx, -hw, -hh, w.w, w.h, 4);
      ctx.fill();
      ctx.fillStyle = '#7A4E30';
      ctx.fillRect(-hw * 0.5, -hh * 0.6, w.w * 0.3, w.h * 0.5);
      ctx.fillRect(hw * 0.2, hh * 0.1, w.w * 0.22, w.h * 0.35);
      ctx.fillStyle = '#26211D';
      ctx.beginPath();
      ctx.ellipse(-hw * 0.1, 0, w.w * 0.22, w.h * 0.32, 0.3, 0, Math.PI * 2);
      ctx.fill();
      if (w.kind === 'truck') {
        ctx.fillStyle = '#3A322C';
        ctx.fillRect(hw - 16, -hh + 2, 14, w.h - 4);
      }
      if (w.kind === 'apc') {
        ctx.fillStyle = '#3E3630';
        ctx.beginPath();
        ctx.arc(2, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2A2622';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(28, -6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawVehicles(ctx, g, inView) {
    for (const v of g.traffic.list) {
      if (!inView(v.x, v.y, 60)) continue;
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.a);
      const hw = v.w / 2;
      const hh = v.h / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      roundRectPath(ctx, -hw + 4, -hh + 5, v.w, v.h, 4);
      ctx.fill();
      if (v.kind === 'nrk') {
        for (const ty of [-hh, hh - 8]) {
          ctx.fillStyle = '#2A2B27';
          roundRectPath(ctx, -hw, ty, v.w, 8, 3);
          ctx.fill();
          ctx.fillStyle = '#4A4C44';
          for (let x = -hw + ((v.bob * 3) % 5); x < hw - 2; x += 5) ctx.fillRect(x, ty + 1, 2.5, 6);
        }
        ctx.fillStyle = '#5E6E4A';
        roundRectPath(ctx, -hw + 4, -hh + 6, v.w - 8, v.h - 12, 4);
        ctx.fill();
        ctx.fillStyle = '#2C3526';
        ctx.fillRect(hw - 10, -4, 6, 8);
      } else if (v.kind === 'quad') {
        ctx.fillStyle = '#1E1E1C';
        for (const sx of [-hw + 4, hw - 4]) {
          ctx.fillRect(sx - 4, -hh - 2, 8, 4);
          ctx.fillRect(sx - 4, hh - 2, 8, 4);
        }
        ctx.fillStyle = '#4E5A3A';
        roundRectPath(ctx, -hw, -hh + 2, v.w, v.h - 4, 4);
        ctx.fill();
        ctx.strokeStyle = '#1E1E1C';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hw - 6, -hh);
        ctx.lineTo(hw - 6, hh);
        ctx.stroke();
        ctx.fillStyle = '#55663A';
        ctx.beginPath();
        ctx.arc(-1, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#1E1E1C';
        for (const sx of [-hw * 0.62, hw * 0.55]) {
          ctx.fillRect(sx - 4.5, -hh - 2, 9, 4);
          ctx.fillRect(sx - 4.5, hh - 2, 9, 4);
        }
        ctx.fillStyle = v.kind === 'van' ? '#6C7A4C' : '#5D6B47';
        roundRectPath(ctx, -hw, -hh, v.w, v.h, 5);
        ctx.fill();
        if (v.kind === 'pickup') {
          ctx.fillStyle = '#4A5639';
          ctx.fillRect(-hw + 3, -hh + 3, v.w * 0.5, v.h - 6);
          ctx.fillStyle = '#CFA35A';
          ctx.fillRect(-hw + 6, -hh + 5, 8, 6);
          ctx.fillRect(-hw + 15, hh - 11, 8, 6);
          ctx.fillStyle = '#56623C';
          roundRectPath(ctx, hw - 22, -hh + 2, 14, v.h - 4, 3);
          ctx.fill();
        } else {
          ctx.fillStyle = '#56623C';
          roundRectPath(ctx, -hw + 3, -hh + 2, v.w - 12, v.h - 4, 4);
          ctx.fill();
        }
        ctx.fillStyle = '#9FC3D0';
        ctx.fillRect(hw - 8, -hh + 3, 3, v.h - 6);
      }
      ctx.restore();
    }
  }

  drawDrops(ctx, g, inView) {
    for (const d of g.fpv.drops) {
      if (!inView(d.x, d.y, 40)) continue;
      const k = clamp(d.t / d.dur, 0, 1);
      const z = d.z * (1 - k * k);
      ctx.fillStyle = `rgba(0,0,0,${(0.15 + 0.3 * k).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(d.x + z * 0.3, d.y + z * 0.4, 2 + 3 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = d.kind === 'grenade' ? '#3A3F2E' : '#556B2F';
      ctx.beginPath();
      ctx.arc(d.x, d.y - z * 0.12, d.kind === 'grenade' ? 3 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawMud(ctx, g, inView) {
    for (const p of g.map.mud) {
      if (!inView(p.x, p.y, p.rx)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = '#8E6B3F';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#765832';
      ctx.beginPath();
      ctx.ellipse(-p.rx * 0.1, 0, p.rx * 0.6, p.ry * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(170,200,210,0.35)';
      ctx.beginPath();
      ctx.ellipse(p.rx * 0.2, -p.ry * 0.15, p.rx * 0.22, p.ry * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawTrail(ctx, g, v) {
    const t = g.trail;
    if (t.length < 2) return;
    ctx.strokeStyle = 'rgba(95,68,36,0.4)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (let i = 0; i < t.length; i++) {
      const p = t[i];
      if (p.x < v.x0 || p.x > v.x1 || p.y < v.y0 || p.y > v.y1) continue;
      // Дотична = нормаль, повернута на 90°
      const tx = p.ny * 1.6;
      const ty = -p.nx * 1.6;
      for (const side of [-15, 15]) {
        const x = p.x + p.nx * side;
        const y = p.y + p.ny * side;
        ctx.moveTo(x - tx, y - ty);
        ctx.lineTo(x + tx, y + ty);
      }
    }
    ctx.stroke();
    ctx.lineCap = 'round';
  }

  drawCraters(ctx, g, inView) {
    for (const c of g.map.craters) {
      if (!inView(c.x, c.y, c.r * 2)) continue;
      if (c.scorch) {
        ctx.fillStyle = 'rgba(45,35,25,0.3)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#A88250';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8C6A3E';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = c.water ? '#5AA7C8' : c.scorch ? '#4A3A28' : '#6F5434';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      if (c.water) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(c.x - c.r * 0.15, c.y - c.r * 0.2, c.r * 0.22, c.r * 0.12, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawMineHints(ctx, g, inView) {
    for (const m of g.map.mines) {
      if (!m.alive || m.known || !inView(m.x, m.y, 20)) continue;
      if (m.dropped) {
        // Скинута з дрона міна лежить зверху - її видно, якщо придивитися
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.ha);
        ctx.fillStyle = '#4F6430';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3B4A24';
        ctx.fillRect(-1, -6, 2, 12);
        ctx.restore();
        continue;
      }
      // Свіжоперекопана земля: уважний оператор помітить. На важких рівнях - ледь видно
      ctx.globalAlpha = CFG.mines.hint;
      ctx.fillStyle = 'rgba(92,68,38,0.55)';
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, 12, 8, m.ha, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,118,72,0.75)';
      ctx.beginPath();
      ctx.ellipse(m.x - 1, m.y - 1, 7, 4.5, m.ha, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,45,25,0.7)';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(m.x + Math.cos(m.ha + k * 2.1) * 9, m.y + Math.sin(m.ha + k * 2.1) * 6, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Ждун: FPV лежить на узбіччі в камуфляжі. Поки не виявлений - ледь помітний
  drawAmbush(ctx, g, inView) {
    for (const f of g.fpv.list) {
      if (f.state !== 'wait' || !inView(f.x, f.y, 20)) continue;
      ctx.globalAlpha = f.known ? 1 : CFG.ambush.hint;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.heading + Math.PI / 4);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(1.5, 2, 10, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3F4A2C';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6.5, -6.5);
      ctx.lineTo(6.5, 6.5);
      ctx.moveTo(6.5, -6.5);
      ctx.lineTo(-6.5, 6.5);
      ctx.stroke();
      ctx.strokeStyle = '#2E3620';
      ctx.lineWidth = 1.4;
      for (const [px, py] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) {
        ctx.beginPath();
        ctx.arc(px, py, 3.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#556238';
      ctx.fillRect(-3.5, -3.5, 7, 7);
      if (f.fiber) {
        ctx.fillStyle = '#C9B98A';
        ctx.beginPath();
        ctx.arc(-1, 6, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  crate(ctx, x, y, a, k = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(k, k);
    ctx.fillStyle = '#CFA35A';
    ctx.fillRect(-7, -5, 14, 10);
    ctx.strokeStyle = '#8A6A33';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(-7, -5, 14, 10);
    ctx.fillStyle = '#8A6A33';
    ctx.fillRect(-1.5, -5, 3, 10);
    ctx.restore();
  }

  // ---------- Опорний пункт ----------
  drawOpGround(ctx, g, inView) {
    for (const op of g.map.ops) if (inView(op.x, op.y, 330)) this.drawOneOp(ctx, op);
  }

  drawOneOp(ctx, op) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Капонір: виїмка з брустверами з трьох боків, відкрита до дороги
    ctx.save();
    ctx.translate(op.capon.x, op.capon.y);
    ctx.rotate(op.a);
    const w = op.capon.w;
    const h = op.capon.h;
    ctx.fillStyle = '#7B6444';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(40,30,20,0.25)';
    ctx.fillRect(-w / 2, -h / 2, w, 8);
    ctx.fillRect(-w / 2, h / 2 - 8, w, 8);
    ctx.fillRect(w / 2 - 8, -h / 2, 8, h);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 4, -h / 2 - 7);
    ctx.lineTo(w / 2 + 7, -h / 2 - 7);
    ctx.lineTo(w / 2 + 7, h / 2 + 7);
    ctx.lineTo(-w / 2 + 4, h / 2 + 7);
    ctx.strokeStyle = '#8C6E45';
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = '#A88A5A';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();

    // Траншея з мішками
    ctx.beginPath();
    op.trench.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = '#6B5436';
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = '#3E3122';
    ctx.lineWidth = 9;
    ctx.stroke();
    for (const b of op.bags) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a + Math.PI / 2);
      ctx.fillStyle = '#C7B27A';
      roundRectPath(ctx, -8, -5, 16, 10, 4);
      ctx.fill();
      ctx.strokeStyle = '#9C8655';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // Бліндаж: накат з колод, присипаний землею
    const d = op.dugout;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.a);
    ctx.fillStyle = 'rgba(30,35,20,0.3)';
    ctx.fillRect(-d.w / 2 + 6, -d.h / 2 + 8, d.w, d.h);
    ctx.fillStyle = '#6E5434';
    ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    ctx.strokeStyle = '#4E3B24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = -d.w / 2 + 5; x < d.w / 2; x += 7) {
      ctx.moveTo(x, -d.h / 2 + 2);
      ctx.lineTo(x, d.h / 2 - 2);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(140,110,70,0.8)';
    ctx.beginPath();
    ctx.ellipse(-8, -4, 18, 11, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(14, 8, 12, 8, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(95,125,60,0.75)';
    ctx.beginPath();
    ctx.ellipse(-14, 10, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#241C12';
    ctx.beginPath();
    ctx.arc(op.dugEntry.x, op.dugEntry.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Тарілка супутникового зв'язку
    ctx.save();
    ctx.translate(op.starlink.x, op.starlink.y);
    ctx.rotate(op.a + 0.4);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-4, -3, 12, 12);
    ctx.fillStyle = '#E8ECEF';
    ctx.fillRect(-6, -6, 12, 12);
    ctx.strokeStyle = '#9AA3A8';
    ctx.lineWidth = 1;
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.restore();
  }

  drawOpNet(ctx, g, inView) {
    for (const op of g.map.ops) {
      if (inView(op.net.x, op.net.y, 130)) this.drawOneOpNet(ctx, op.net, g.phase === 'unloading' && g.unloadOp === op.idx);
    }
  }

  drawOneOpNet(ctx, n, faded) {
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.a);
    ctx.globalAlpha = faded ? 0.5 : 0.8;
    ctx.fillStyle = 'rgba(70,85,45,0.55)';
    roundRectPath(ctx, -n.w / 2, -n.h / 2, n.w, n.h, 10);
    ctx.fill();
    for (const l of n.leaves) {
      ctx.fillStyle = l.c;
      ctx.beginPath();
      ctx.ellipse(l.lx, l.ly, l.r, l.r * 0.6, l.a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(30,35,20,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = -n.w / 2; x <= n.w / 2; x += 7) {
      ctx.moveTo(x, -n.h / 2);
      ctx.lineTo(x, n.h / 2);
    }
    for (let y = -n.h / 2; y <= n.h / 2; y += 7) {
      ctx.moveTo(-n.w / 2, y);
      ctx.lineTo(n.w / 2, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- База ----------
  drawGarageFloor(ctx, g, inView) {
    const ga = g.map.garage;
    const b = g.map.base;
    if (!inView(ga.x, ga.y, 220)) return;
    ctx.fillStyle = '#A29E92';
    ctx.fillRect(ga.x + ga.w / 2 - 2, b.y - 42, b.x - (ga.x + ga.w / 2) + 34, 84);
    ctx.strokeStyle = 'rgba(80,78,70,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ga.x + ga.w / 2 - 2, b.y - 42, b.x - (ga.x + ga.w / 2) + 34, 84);
    ctx.save();
    ctx.translate(ga.x, ga.y);
    ctx.rotate(ga.a);
    const w = ga.w;
    const h = ga.h;
    ctx.fillStyle = 'rgba(30,35,20,0.3)';
    ctx.fillRect(-w / 2 + 8, -h / 2 + 10, w, h);
    ctx.fillStyle = '#77736A';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(40,38,34,0.35)';
    ctx.beginPath();
    ctx.ellipse(26, 6, 16, 10, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    for (const c of ga.stack) if (!c.taken) this.crate(ctx, c.x, c.y, 0);
  }

  drawGarageTop(ctx, g, inView) {
    const ga = g.map.garage;
    if (!inView(ga.x, ga.y, 220)) return;
    ctx.save();
    ctx.translate(ga.x, ga.y);
    ctx.rotate(ga.a);
    const w = ga.w;
    const h = ga.h;
    const rw = w * ga.roofFrac;
    // Уцілілий шматок даху з рваним краєм
    ctx.fillStyle = '#A9A69C';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2 + rw, -h / 2);
    for (let k = 1; k <= 6; k++) ctx.lineTo(-w / 2 + rw + (k % 2 ? 9 : 1), -h / 2 + (k * h) / 6);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,78,70,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = -h / 2 + 6; y < h / 2; y += 8) {
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(-w / 2 + rw, y);
    }
    ctx.stroke();
    // Голі балки над відкритою частиною
    ctx.strokeStyle = '#5E5A52';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = -w / 2 + rw + 20; x < w / 2 - 6; x += 26) {
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
    }
    ctx.stroke();
    // Стіни
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#8F8A7F';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w / 2, -h / 2);
    ctx.lineTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(w / 2, h / 2);
    ctx.stroke();
    // Ворота: дві стулки на петлях у кутах східної стіни
    const open = clamp(ga.gate, 0, 1);
    const L = h / 2 - 1;
    const a1 = (Math.PI / 2) * (1 - open);
    const a2 = -a1;
    ctx.strokeStyle = '#4F5E3E';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w / 2, -h / 2);
    ctx.lineTo(w / 2 + Math.cos(a1) * L, -h / 2 + Math.sin(a1) * L);
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.cos(a2) * L, h / 2 + Math.sin(a2) * L);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.restore();
  }

  // ---------- Піхота ----------
  drawCrew(ctx, g, inView) {
    for (const s of g.crew.list) {
      if (!s.visible || !inView(s.x, s.y, 20)) continue;
      this.drawSoldier(ctx, s);
    }
  }

  drawSoldier(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(2, 3, 6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    const k = Math.sin(s.walk) * 3;
    ctx.fillStyle = '#2F3324';
    ctx.beginPath();
    ctx.ellipse(k, -3.2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-k, 3.2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4C5631';
    roundRectPath(ctx, -7, -5, 6, 10, 2);
    ctx.fill();
    ctx.fillStyle = '#66733F';
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (s.carry) {
      this.crate(ctx, 8, 0, 0, 0.75);
      ctx.fillStyle = '#66733F';
      ctx.fillRect(2, -6.5, 5, 2.5);
      ctx.fillRect(2, 4, 5, 2.5);
    } else if (s.tag === 'post') {
      ctx.strokeStyle = '#1E1E1A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(2, 2.5);
      ctx.lineTo(13, 2.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#55663A';
    ctx.beginPath();
    ctx.arc(0.5, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3A4628';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawTracers(ctx, g) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,228,120,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const t of g.tracers) {
      if (t.t < 0) continue;
      const k = t.t / t.dur;
      const k0 = Math.max(0, k - 0.35);
      ctx.moveTo(t.x0 + (t.x1 - t.x0) * k0, t.y0 + (t.y1 - t.y0) * k0);
      ctx.lineTo(t.x0 + (t.x1 - t.x0) * k, t.y0 + (t.y1 - t.y0) * k);
    }
    ctx.stroke();
  }

  // ---------- Мінні поля й сітки ----------
  mineSign(ctx, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(x + 3, y + 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#D7261E';
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7.5, y + 4.5);
    ctx.lineTo(x - 7.5, y + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x - 0.9, y - 3.5, 1.8, 4.2);
    ctx.fillRect(x - 0.9, y + 1.6, 1.8, 1.6);
  }

  drawMinefields(ctx, g, inView) {
    for (const mf of g.map.minefields) {
      if (!inView(mf.x, mf.y, mf.rx + 20)) continue;
      ctx.save();
      ctx.translate(mf.x, mf.y);
      ctx.rotate(mf.a);
      ctx.fillStyle = 'rgba(125,120,55,0.22)';
      ctx.beginPath();
      ctx.ellipse(0, 0, mf.rx, mf.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(230,60,50,0.75)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      mf.signs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const sg of mf.signs) this.mineSign(ctx, sg.x, sg.y);
    }
  }

  drawNets(ctx, g, inView) {
    for (const nt of g.map.nets) {
      const bb = nt.bb;
      const cx = (bb.x0 + bb.x1) / 2;
      const cy = (bb.y0 + bb.y1) / 2;
      if (!inView(cx, cy, Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 + 20)) continue;
      const outline = () => {
        ctx.beginPath();
        nt.left.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        for (let i = nt.right.length - 1; i >= 0; i--) ctx.lineTo(nt.right[i].x, nt.right[i].y);
        ctx.closePath();
      };
      ctx.save();
      outline();
      ctx.fillStyle = 'rgba(25,32,22,0.16)';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(25,30,22,0.42)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      const hgt = bb.y1 - bb.y0;
      const span = bb.x1 - bb.x0 + hgt;
      for (let d = -hgt; d <= span; d += 8) {
        ctx.moveTo(bb.x0 + d, bb.y0);
        ctx.lineTo(bb.x0 + d + hgt, bb.y1);
        ctx.moveTo(bb.x0 + d, bb.y1);
        ctx.lineTo(bb.x0 + d + hgt, bb.y0);
      }
      ctx.stroke();
      for (const h of nt.holes) {
        ctx.fillStyle = 'rgba(40,30,20,0.3)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(20,20,15,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = 0; k <= 12; k++) {
          const ang = h.a + (k / 12) * Math.PI * 2;
          const rr = h.r * (k % 2 ? 1 : 0.65);
          const px = h.x + Math.cos(ang) * rr;
          const py = h.y + Math.sin(ang) * rr;
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      for (const sg of nt.sags) this.drawSag(ctx, sg);
      ctx.restore();
      ctx.strokeStyle = 'rgba(40,40,30,0.75)';
      ctx.lineWidth = 1.5;
      for (const side of [nt.left, nt.right]) {
        ctx.beginPath();
        side.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      for (const p of nt.poles) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(p.x + 3, p.y + 4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5A4630';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Провис: сітка звисає клубком, з неї тягнуться пасма
  drawSag(ctx, sg) {
    ctx.fillStyle = 'rgba(18,22,14,0.5)';
    ctx.beginPath();
    ctx.ellipse(sg.x, sg.y, sg.r, sg.r * 0.78, sg.a, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(12,14,10,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -3; k <= 3; k++) {
      const o = (k * sg.r) / 4;
      ctx.moveTo(sg.x - sg.r * 0.8, sg.y + o);
      ctx.lineTo(sg.x + sg.r * 0.8, sg.y + o * 0.6);
      ctx.moveTo(sg.x + o, sg.y - sg.r * 0.7);
      ctx.lineTo(sg.x + o * 0.7, sg.y + sg.r * 0.7);
    }
    for (let k = 0; k < 6; k++) {
      const a = sg.a + k * 1.05;
      ctx.moveTo(sg.x + Math.cos(a) * sg.r * 0.6, sg.y + Math.sin(a) * sg.r * 0.6);
      ctx.quadraticCurveTo(sg.x + Math.cos(a + 0.4) * sg.r * 1.2, sg.y + Math.sin(a + 0.4) * sg.r * 1.2, sg.x + Math.cos(a) * sg.r * 1.5, sg.y + Math.sin(a) * sg.r * 1.5);
    }
    ctx.stroke();
  }

  drawRuinsFloor(ctx, g, inView) {
    for (const r of g.map.ruins) {
      if (!inView(r.x, r.y, 140)) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.a);
      ctx.fillStyle = 'rgba(30,35,20,0.28)';
      ctx.fillRect(-r.w / 2 + 8, -r.h / 2 + 10, r.w, r.h);
      ctx.fillStyle = '#8A857A';
      ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
      ctx.fillStyle = '#A39E93';
      for (const q of r.rubble) {
        ctx.save();
        ctx.translate(r.x + q.dx, r.y + q.dy);
        ctx.rotate(q.a);
        ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * 0.7);
        ctx.restore();
      }
    }
  }

  drawRuinsTop(ctx, g, inView) {
    for (const r of g.map.ruins) {
      if (!inView(r.x, r.y, 140)) continue;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.a);
      const w = r.w;
      const h = r.h;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#C3BEB2';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, -h / 2);
      ctx.lineTo(w / 2, -h * 0.05);
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(-w * 0.1, h / 2);
      ctx.moveTo(-w / 2, h * 0.25);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.stroke();
      ctx.strokeStyle = '#8F8A7F';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#6F6B63';
      ctx.fillRect(-w / 2 + 8, -h / 2 + 8, w * 0.35, h * 0.32);
      ctx.lineCap = 'round';
      ctx.restore();
    }
  }

  drawTreeShadows(ctx, g, inView) {
    ctx.fillStyle = 'rgba(20,45,12,0.32)';
    ctx.beginPath();
    for (const t of g.map.trees) {
      if (!inView(t.x, t.y, t.r + 12)) continue;
      ctx.moveTo(t.x + 7 + t.r, t.y + 9);
      ctx.arc(t.x + 7, t.y + 9, t.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  drawCrowns(ctx, g, inView) {
    const vis = this._vis || (this._vis = []);
    vis.length = 0;
    for (const t of g.map.trees) if (inView(t.x, t.y, t.r)) vis.push(t);
    for (const pal of TREE_PALETTES) {
      ctx.fillStyle = pal[0];
      ctx.beginPath();
      for (const t of vis) {
        if (t.c1 !== pal[0]) continue;
        ctx.moveTo(t.x + t.r, t.y);
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    for (const pal of TREE_PALETTES) {
      ctx.fillStyle = pal[1];
      ctx.beginPath();
      for (const t of vis) {
        if (t.c1 !== pal[0]) continue;
        const hx = t.x - t.r * t.hx;
        const hy = t.y - t.r * t.hy;
        ctx.moveTo(hx + t.r * 0.52, hy);
        ctx.arc(hx, hy, t.r * 0.52, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  drawRobot(ctx, r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.a);
    ctx.fillStyle = 'rgba(20,30,10,0.35)';
    roundRectPath(ctx, -25, -15, 60, 44, 6);
    ctx.fill();
    for (const ty of [-22, 11]) {
      ctx.fillStyle = '#2A2B27';
      roundRectPath(ctx, -30, ty, 60, 11, 4);
      ctx.fill();
      ctx.fillStyle = '#4A4C44';
      for (let x = -30 + r.trackPhase; x < 28; x += 6) ctx.fillRect(x, ty + 1, 3, 9);
    }
    ctx.fillStyle = '#5A7048';
    roundRectPath(ctx, -25, -15, 50, 30, 5);
    ctx.fill();
    ctx.strokeStyle = '#3C4D31';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(40,52,30,0.7)';
    ctx.strokeRect(-18, -10, 26, 20);
    const crates = Math.min(4, Math.ceil(r.cargo / 10));
    const slots = [[-11.5, -5], [1.5, -5], [-11.5, 5], [1.5, 5]];
    for (let i = 0; i < crates; i++) this.crate(ctx, slots[i][0], slots[i][1], 0, 0.86);
    ctx.fillStyle = '#2C3526';
    ctx.fillRect(15, -6, 8, 12);
    ctx.fillStyle = r.dmg.camera ? '#FF5A4E' : '#9FE3FF';
    ctx.fillRect(19, -2, 4, 4);
    ctx.strokeStyle = '#1F261A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-21, 11);
    ctx.lineTo(-27, 17);
    ctx.stroke();
    if (r.dmg.tracks) {
      ctx.fillStyle = 'rgba(30,25,20,0.6)';
      ctx.beginPath();
      ctx.arc(-6, r.drift > 0 ? 16 : -16, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!r.alive) {
      ctx.fillStyle = 'rgba(25,20,15,0.72)';
      roundRectPath(ctx, -31, -23, 62, 46, 6);
      ctx.fill();
    }
    if (r.tangle > 0) {
      // Сітка намоталась на гусениці
      ctx.strokeStyle = 'rgba(18,20,14,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -34; k <= 30; k += 6) {
        ctx.moveTo(k, -25);
        ctx.lineTo(k + 12, 25);
        ctx.moveTo(k, 25);
        ctx.lineTo(k + 12, -25);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFpv(ctx, f) {
    if (f.bomber) {
      this.drawBomber(ctx, f);
      return;
    }
    if (f.fiber) {
      ctx.strokeStyle = 'rgba(240,240,230,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.sx, f.sy);
      ctx.quadraticCurveTo((f.sx + f.x) / 2 + 30, (f.sy + f.y) / 2 + 20, f.x, f.y);
      ctx.stroke();
    }
    const sh = f.z * 0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(f.x + sh, f.y + sh * 1.3, 6, 0, Math.PI * 2);
    ctx.fill();
    const c = f.fiber ? '#FFB020' : '#FF7A1A';
    ctx.save();
    ctx.translate(f.x, f.y - f.z * 0.12);
    ctx.rotate(f.heading + Math.PI / 4);
    ctx.lineCap = 'round';
    for (const [lw, col] of [[4.5, '#3A2A1A'], [2.5, c]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(-7, -7);
      ctx.lineTo(7, 7);
      ctx.moveTo(7, -7);
      ctx.lineTo(-7, 7);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.8;
    for (const [px, py] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#2A2A2A';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  }

  // ---------- Перешкоди сигналу ----------
  // Дрон зі скидами: сірий квадрокоптер високо в небі, під ним боєприпас
  drawBomber(ctx, f) {
    const sh = f.z * 0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(f.x + sh, f.y + sh * 1.3, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(f.x, f.y - f.z * 0.12);
    ctx.rotate(f.heading);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4E5358';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-9, -9);
    ctx.lineTo(9, 9);
    ctx.moveTo(9, -9);
    ctx.lineTo(-9, 9);
    ctx.stroke();
    for (const [px, py] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
      ctx.fillStyle = 'rgba(225,230,235,0.35)';
      ctx.strokeStyle = '#8C9298';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(60,65,70,0.7)';
      ctx.beginPath();
      const a = f.spin + px;
      ctx.moveTo(px + Math.cos(a) * 5, py + Math.sin(a) * 5);
      ctx.lineTo(px - Math.cos(a) * 5, py - Math.sin(a) * 5);
      ctx.stroke();
    }
    ctx.fillStyle = '#9AA0A6';
    roundRectPath(ctx, -7, -5, 14, 10, 3);
    ctx.fill();
    ctx.fillStyle = '#2A2A2A';
    ctx.fillRect(5, -2, 3, 4);
    if (f.drops > 0 && f.state !== 'leave') {
      ctx.fillStyle = '#3A3F2E';
      ctx.beginPath();
      ctx.arc(-1, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSignalFx(ctx, g) {
    const w = this.cw;
    const h = this.ch;
    const q = (5 - g.signal.bars) / 4;
    const cam = g.robot.dmg.camera ? 1 : 0;
    const desat = Math.min(0.9, q * 0.85 + cam * 0.2);
    if (desat > 0.01) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(128,128,128,${desat.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(10,14,10,${(q * 0.2).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    const na = 0.035 + q * 0.42 + cam * 0.14;
    ctx.save();
    ctx.globalAlpha = na;
    const nx = Math.floor(Math.random() * 128);
    const ny = Math.floor(Math.random() * 128);
    ctx.translate(-nx, -ny);
    ctx.fillStyle = this.noisePat;
    ctx.fillRect(0, 0, w + 128, h + 128);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.07 + q * 0.22;
    ctx.fillStyle = this.scanPat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    if (q > 0.4 && Math.random() < q * 0.5) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const y = Math.random() * h;
        const bh = 4 + Math.random() * 18;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(0, y, w, bh);
        ctx.fillStyle = 'rgba(255,90,200,0.35)';
        ctx.fillRect(0, y, w, 1);
        ctx.fillStyle = 'rgba(90,220,255,0.35)';
        ctx.fillRect(0, y + bh, w, 1);
      }
    }

    if (!this.vignette) {
      const gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.5)');
      this.vignette = gr;
    }
    ctx.globalAlpha = 0.55 + cam * 0.45;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    if (cam) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      const cx = w * 0.72;
      const cy = h * 0.32;
      ctx.beginPath();
      for (const c of this.cracks) {
        const L = c.l * Math.min(w, h);
        ctx.moveTo(cx, cy);
        const mx = cx + Math.cos(c.a) * L * 0.5;
        const my = cy + Math.sin(c.a) * L * 0.5;
        ctx.lineTo(mx, my);
        ctx.lineTo(mx + Math.cos(c.a + c.k) * L * 0.5, my + Math.sin(c.a + c.k) * L * 0.5);
      }
      ctx.stroke();
    }
  }

  // ---------- Доповнена реальність: світові координати ----------
  zoneRing(ctx, x, y, r, color, active) {
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = active ? -this.time * 20 : 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Зелені шеврони по дорозі показують маршрут на найближчі ~900 px
  drawAR(ctx, g, inView) {
    const m = g.map;
    const r = g.robot;
    const t = this.time;

    for (const z of m.rebZones) {
      if (!inView(z.x, z.y, z.r)) continue;
      ctx.setLineDash([3, 9]);
      ctx.strokeStyle = 'rgba(200,140,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const toBase = g.phase === 'return' || g.phase === 'parking';
    if (toBase) this.zoneRing(ctx, m.base.x, m.base.y, CFG.baseRadius, '#8BF28A', true);
    if (g.phase === 'outbound') {
      const c = m.ops[g.task.op].capon;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.a);
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = g.task.next !== null ? '#FFBE3C' : '#8BF28A';
      ctx.lineWidth = 2.5;
      roundRectPath(ctx, -c.w / 2 + 4, -c.h / 2 + 4, c.w - 8, c.h - 8, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    for (const op of m.ops) {
      if (op.status !== 'fire' || !inView(op.capon.x, op.capon.y, 200)) continue;
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = `rgba(255,70,60,${(0.5 + 0.3 * Math.sin(t * 5)).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(op.capon.x, op.capon.y, 160, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const mf of m.minefields) {
      if (!inView(mf.x, mf.y, mf.rx) || Math.hypot(mf.x - r.x, mf.y - r.y) > 560) continue;
      ctx.save();
      ctx.translate(mf.x, mf.y);
      ctx.rotate(mf.a);
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = 'rgba(255,80,70,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, mf.rx, mf.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    for (const mi of m.mines) {
      if (!mi.alive || !mi.known || !inView(mi.x, mi.y, 40)) continue;
      const k = mi.revealT === undefined ? 1 : Math.min(1, mi.revealT);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#FFD24A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mi.x, mi.y, 15 + (1 - k) * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#C62828';
      ctx.beginPath();
      ctx.arc(mi.x, mi.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Провиси сітки поруч
    for (const nt of m.nets) {
      if (r.x < nt.bb.x0 - 380 || r.x > nt.bb.x1 + 380 || r.y < nt.bb.y0 - 380 || r.y > nt.bb.y1 + 380) continue;
      for (const sg of nt.sags) {
        if (dist(sg.x, sg.y, r.x, r.y) > 380) continue;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(255,170,60,0.85)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sg.x, sg.y, sg.r + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (r.reb.on) {
      ctx.fillStyle = 'rgba(120,220,255,0.06)';
      ctx.beginPath();
      ctx.arc(r.x, r.y, CFG.reb.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 40;
      ctx.strokeStyle = 'rgba(120,220,255,0.8)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    g.fx.drawRings(ctx);

    // Пристрілка: куди прилетить
    for (const sh of g.fpv.shells) {
      if (!sh.aimed || !inView(sh.x, sh.y, 60)) continue;
      const k = clamp(1 - sh.t / sh.dur, 0, 1);
      const R = CFG.shell.blast;
      ctx.fillStyle = `rgba(255,59,48,${(0.1 + 0.25 * k).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, R + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
    }

    // Скиди: де впаде граната
    for (const d of g.fpv.drops) {
      if (d.kind !== 'grenade' || !inView(d.x, d.y, 40)) continue;
      const k = clamp(d.t / d.dur, 0, 1);
      ctx.fillStyle = `rgba(255,59,48,${(0.12 + 0.25 * k).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(d.x - d.r - 6, d.y);
      ctx.lineTo(d.x - d.r + 7, d.y);
      ctx.moveTo(d.x + d.r + 6, d.y);
      ctx.lineTo(d.x + d.r - 7, d.y);
      ctx.moveTo(d.x, d.y - d.r - 6);
      ctx.lineTo(d.x, d.y - d.r + 7);
      ctx.moveTo(d.x, d.y + d.r + 6);
      ctx.lineTo(d.x, d.y + d.r - 7);
      ctx.stroke();
    }

    for (const f of g.fpv.list) {
      if (f.state === 'wait') {
        // Виявлений ждун: де він і з якої відстані злетить
        if (!f.known || !inView(f.x, f.y, CFG.ambush.wake)) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 5 + f.id);
        ctx.setLineDash([5, 7]);
        ctx.strokeStyle = 'rgba(255,90,60,0.5)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(f.x, f.y, CFG.ambush.wake, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = f.fiber ? '#FFB020' : '#FF7A1A';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 14 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (f.state === 'dive') {
        const k = 1 - Math.max(0, f.diveT) / CFG.fpv.diveTime;
        const rr = CFG.fpv.hitRadius * (2 - k);
        ctx.fillStyle = 'rgba(255,59,48,0.16)';
        ctx.beginPath();
        ctx.arc(f.ix, f.iy, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FF3B30';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(f.ix - rr - 6, f.iy);
        ctx.lineTo(f.ix - rr + 8, f.iy);
        ctx.moveTo(f.ix + rr + 6, f.iy);
        ctx.lineTo(f.ix + rr - 8, f.iy);
        ctx.moveTo(f.ix, f.iy - rr - 6);
        ctx.lineTo(f.ix, f.iy - rr + 8);
        ctx.moveTo(f.ix, f.iy + rr + 6);
        ctx.lineTo(f.ix, f.iy + rr - 8);
        ctx.stroke();
      }
      if (f.state === 'jammed' || !inView(f.x, f.y, 30)) continue;
      ctx.strokeStyle = f.bomber ? '#FFD24A' : f.fiber ? '#FFB020' : '#FF7A1A';
      ctx.lineWidth = 2;
      if (f.fiber || f.bomber) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(f.x, f.y - f.z * 0.12, f.bomber ? 19 : 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (g.inCover && r.alive && !g.locked) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.a);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.6;
      roundRectPath(ctx, -31, -23, 62, 46, 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(31, 0);
      ctx.lineTo(39, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  pill(ctx, x, y, text, bg, fg, size = 11) {
    x = Math.round(x);
    y = Math.round(y);
    ctx.font = `700 ${size}px ${MONO}`;
    const w = ctx.measureText(text).width + 14;
    const h = size + 8;
    ctx.fillStyle = bg;
    roundRectPath(ctx, x - w / 2, y - h / 2, w, h, 7);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    return w;
  }

  edgeArrow(ctx, wx, wy, color, label, fg, force = false) {
    const p = this.toScreen(wx, wy);
    return this.edgeArrowAt(ctx, p, color, label, fg, force);
  }

  edgeArrowAt(ctx, p, color, label, fg, force) {
    const top = 128; // нижче банера посередині
    const bottom = this.ch - 60;
    const left = 40;
    const right = this.cw - 40;
    if (!force && p.x > left && p.x < right && p.y > top && p.y < bottom) return false;
    const cx = this.cw / 2;
    const cy = (top + bottom) / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (Math.abs(dx) + Math.abs(dy) < 1) return false;
    const kx = dx !== 0 ? ((dx > 0 ? right : left) - cx) / dx : Infinity;
    const ky = dy !== 0 ? ((dy > 0 ? bottom : top) - cy) / dy : Infinity;
    const k = Math.min(Math.abs(kx), Math.abs(ky));
    const ex = cx + dx * k;
    let ey = cy + dy * k;
    // Не залазимо під мінікарту, кнопки дій і джойстик
    if (ex > this.cw - 230 && ey < 170) ey = 170;
    if (ex > this.cw - 210 && ey > this.ch - 205) ey = this.ch - 205;
    if (ex < 230 && ey > this.ch - 175) ey = this.ch - 175;
    const a = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -9);
    ctx.lineTo(-6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (label) {
      const lx = ex - Math.cos(a) * 46;
      const ly = ey - Math.sin(a) * 22;
      this.pill(ctx, clamp(lx, 70, this.cw - 70), ly, label, color, fg || '#FFFFFF', 10);
    }
    return true;
  }

  // Чи перекриє підпис шириною 2*hw мінікарту, кнопки чи джойстик
  blocked(x, y, hw = 30) {
    const xl = x - hw;
    const xr = x + hw;
    return (
      y < 80 ||
      (xr > this.cw - 225 && y < 165) ||
      (xr > this.cw - 200 && y > this.ch - 200) ||
      (xl < 220 && y > this.ch - 175) ||
      (y > this.ch - 34 && Math.abs(x - this.cw / 2) < 190 + hw)
    );
  }

  drawARScreen(ctx, g) {
    const m = g.map;
    const r = g.robot;
    const M = CFG.metersPerPx;
    const S = this.scale;
    const onScreen = (p, pad = 0) => p.x > pad && p.x < this.cw - pad && p.y > pad && p.y < this.ch - pad;

    // Ціль маршруту: підпис, коли вона на екрані. Шлях до неї - на мінікарті
    const toBase = g.phase === 'return' || g.phase === 'parking';
    const op = m.ops[g.task.op];
    if (!g.locked && g.route) {
      const tLabel = toBase ? 'БАЗА' : `ОП «${op.name}»`;
      const tgt = toBase ? m.base : op.capon;
      const tp = this.toScreen(tgt.x, tgt.y);
      const stale = g.task.next !== null && !toBase;
      const color = stale ? '#B7791F' : '#1E7A4C';
      if (onScreen(tp, 40)) {
        const lp = toBase ? { x: m.base.x, y: m.base.y - CFG.baseRadius - 6 } : op.labelPt;
        const q = this.toScreen(lp.x, lp.y);
        if (!this.blocked(q.x, q.y - 8, 60)) this.pill(ctx, q.x, q.y - 8, tLabel, color, '#FFFFFF');
      }
    }

    for (const o of m.ops) {
      if (o.status === 'fire' || (!toBase && o.idx === g.task.op)) continue;
      const q = this.toScreen(o.labelPt.x, o.labelPt.y);
      if (onScreen(q, 30) && !this.blocked(q.x, q.y - 8, 60)) this.pill(ctx, q.x, q.y - 8, `ОП «${o.name}»`, 'rgba(60,66,56,0.85)', '#E6ECE0', 10);
    }
    for (const o of m.ops) {
      if (o.status !== 'fire') continue;
      const q = this.toScreen(o.labelPt.x, o.labelPt.y);
      if (onScreen(q, 30) && !this.blocked(q.x, q.y - 26, 90)) this.pill(ctx, q.x, q.y - 26, `ОП «${o.name}» · ОБСТРІЛ`, '#B3261E', '#FFFFFF', 10);
    }

    for (const z of m.rebZones) {
      const p = this.toScreen(z.x, z.y - z.r);
      if (p.x < -60 || p.x > this.cw + 60 || p.y < 70 || p.y > this.ch) continue;
      if (!this.blocked(p.x, p.y)) this.pill(ctx, p.x, p.y, 'РЕБ ворога', 'rgba(110,60,170,0.85)', '#FFFFFF', 10);
    }

    for (const b of m.bridges) {
      if (!b.broken) continue;
      const p = this.toScreen(b.x, b.y);
      if (onScreen(p, 20) && !this.blocked(p.x, p.y - 56, 70)) this.pill(ctx, p.x, p.y - 56, 'МІСТ ЗРУЙНОВАНО', '#B3261E', '#FFFFFF', 10);
    }

    for (const mi of m.mines) {
      if (!mi.alive || !mi.known) continue;
      if (Math.abs(mi.x - r.x) > 300 || Math.abs(mi.y - r.y) > 220) continue;
      const p = this.toScreen(mi.x, mi.y);
      const ly = p.y + 28 * S * 0.8;
      if (!this.blocked(p.x, ly)) this.pill(ctx, p.x, ly, 'МІНА', '#C62828', '#FFFFFF', 10);
    }

    let sagShown = false;
    if (g.curNet) {
      for (const sg of g.curNet.sags) {
        if (sagShown || dist(sg.x, sg.y, r.x, r.y) > 300) continue;
        const p = this.toScreen(sg.x, sg.y - sg.r - 14);
        if (!this.blocked(p.x, p.y)) {
          this.pill(ctx, p.x, p.y, 'ПРОВИС', '#B7791F', '#FFFFFF', 10);
          sagShown = true;
        }
      }
    }

    for (const sh of g.fpv.shells) {
      if (!sh.aimed) continue;
      const p = this.toScreen(sh.x, sh.y - CFG.shell.blast - 12);
      if (onScreen(p) && !this.blocked(p.x, p.y)) this.pill(ctx, p.x, p.y, 'ПРИЛІТ', '#B3261E', '#FFFFFF', 10);
    }
    for (const d of g.fpv.drops) {
      if (d.kind !== 'grenade') continue;
      const p = this.toScreen(d.x, d.y - d.r - 12);
      if (onScreen(p) && !this.blocked(p.x, p.y)) this.pill(ctx, p.x, p.y, 'СКИД', '#B3261E', '#FFFFFF', 10);
    }

    for (const f of g.fpv.list) {
      if (f.state === 'jammed') continue;
      if (f.state === 'wait') {
        if (!f.known) continue;
        const p = this.toScreen(f.x, f.y - 26);
        if (onScreen(p, 20) && !this.blocked(p.x, p.y, 40)) this.pill(ctx, p.x, p.y, f.fiber ? 'ЖДУН · ОПТ' : 'ЖДУН', '#B3261E', '#FFFFFF', 10);
        continue;
      }
      const d = Math.hypot(f.x - r.x, f.y - r.y);
      const detected = d < g.fpv.range(f);
      const p = this.toScreen(f.x, f.y - f.z * 0.12);
      const vis = onScreen(p);
      const col = f.bomber ? '#FFD24A' : f.fiber ? '#FFB020' : '#FF7A1A';
      const label = `${f.bomber ? 'БПЛА' : f.fiber ? 'ОПТ' : 'FPV'} ${Math.round((d * M) / 5) * 5} м`;
      if (vis && !this.blocked(p.x + 46, p.y - 18, 40)) this.pill(ctx, p.x + 46, p.y - 18, label, col, '#2A1200', 10);
      else if (!vis && detected) this.edgeArrow(ctx, f.x, f.y, col, label, '#2A1200');
    }

    // Статус під НРК
    if (!r.alive || g.locked) return;
    const rp = this.toScreen(r.x, r.y);
    const py = rp.y - 34 * S;
    if (r.tangle > 0) this.pill(ctx, rp.x, py, 'ЗАПЛУТАВСЯ', 'rgba(198,40,40,0.92)', '#FFFFFF', 10);
    else if (g.underNet) this.pill(ctx, rp.x, py, 'ПІД СІТКОЮ', 'rgba(20,110,130,0.92)', '#FFFFFF', 10);
    else if (g.inCover) this.pill(ctx, rp.x, py, 'УКРИТТЯ', 'rgba(30,122,76,0.92)', '#FFFFFF', 10);
    else if (g.loitering) this.pill(ctx, rp.x, py, 'ТЕБЕ ЗАСІКАЮТЬ', 'rgba(198,40,40,0.9)', '#FFFFFF', 10);
  }


}
