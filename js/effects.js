// Частинки: пил, вибухи, дим. Кільця: скан, РЕБ (малюються поверх відео, у шарі доповненої реальності).
export class Effects {
  constructor() {
    this.parts = [];
    this.rings = [];
  }

  dust(x, y, a) {
    if (this.parts.length > 260) return;
    this.parts.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      vx: -Math.cos(a) * 12 + (Math.random() - 0.5) * 14,
      vy: -Math.sin(a) * 12 + (Math.random() - 0.5) * 14,
      r: 4 + Math.random() * 4,
      gr: 12,
      life: 0,
      max: 0.7,
      color: '232,214,176',
      a0: 0.55,
      drag: 1.5,
    });
  }

  explosion(x, y, big) {
    const k = big ? 1.4 : 1;
    this.parts.push({ x, y, vx: 0, vy: 0, r: 8 * k, gr: 160 * k, life: 0, max: 0.18, color: '255,244,200', a0: 0.95, drag: 0 });
    for (let i = 0; i < 10 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90 * k;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6 + Math.random() * 6 * k, gr: -6, life: 0, max: 0.35 + Math.random() * 0.2, color: Math.random() < 0.5 ? '255,140,40' : '255,200,70', a0: 0.9, drag: 4 });
    }
    for (let i = 0; i < 9 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 40;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 8 + Math.random() * 8 * k, gr: 18, life: -Math.random() * 0.15, max: 1.4 + Math.random() * 0.8, color: Math.random() < 0.5 ? '90,90,85' : '120,115,105', a0: 0.6, drag: 1.2 });
    }
    for (let i = 0; i < 12 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 160 * k;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.5 + Math.random() * 1.5, gr: 0, life: 0, max: 0.5 + Math.random() * 0.3, color: '60,45,30', a0: 0.9, drag: 3 });
    }
  }

  puff(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 25;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 4 + Math.random() * 4, gr: 10, life: 0, max: 0.9, color: '110,110,105', a0: 0.5, drag: 1.5 });
    }
  }

  ring(x, y, r0, r1, dur, color, lw = 2.5) {
    this.rings.push({ x, y, r0, r1, dur, t: 0, color, lw });
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life < 0) continue;
      if (p.life >= p.max) {
        this.parts.splice(i, 1);
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r = Math.max(0.5, p.r + p.gr * dt);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.dur) this.rings.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const p of this.parts) {
      if (p.life < 0) continue;
      const a = p.a0 * (1 - p.life / p.max);
      ctx.fillStyle = `rgba(${p.color},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRings(ctx) {
    for (const r of this.rings) {
      const k = r.t / r.dur;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = r.lw;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
