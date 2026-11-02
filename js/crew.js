// Піхота: прості скриптові фігурки. Кожен боєць виконує чергу дій:
// { go: [x, y] } - йти в точку, { wait: сек }, { call: fn } - подія (взяв / поклав ящик).
export class Crew {
  constructor() {
    this.list = [];
  }

  add(x, y, a, opts = {}) {
    const s = {
      x,
      y,
      a,
      carry: false,
      queue: [],
      walk: Math.random() * 6,
      speed: opts.speed || 62,
      visible: opts.visible !== false,
      aim: false,
      tag: opts.tag || '',
    };
    this.list.push(s);
    return s;
  }

  byTag(tag) {
    return this.list.filter((s) => s.tag === tag);
  }

  update(dt) {
    for (const s of this.list) {
      let guard = 0;
      while (s.queue.length && guard++ < 4) {
        const q = s.queue[0];
        if (q.go) {
          const dx = q.go[0] - s.x;
          const dy = q.go[1] - s.y;
          const d = Math.hypot(dx, dy);
          if (d < 1.5) {
            s.queue.shift();
            continue;
          }
          const step = Math.min(d, s.speed * dt);
          s.x += (dx / d) * step;
          s.y += (dy / d) * step;
          s.a = Math.atan2(dy, dx);
          s.walk += dt * 11;
          break;
        } else if (q.wait !== undefined) {
          q.wait -= dt;
          if (q.wait <= 0) s.queue.shift();
          else break;
        } else if (q.face !== undefined) {
          s.a = q.face;
          s.queue.shift();
        } else if (q.call) {
          s.queue.shift();
          q.call(s);
        } else s.queue.shift();
      }
    }
  }

  idle(tag) {
    return this.byTag(tag).every((s) => s.queue.length === 0);
  }
}
