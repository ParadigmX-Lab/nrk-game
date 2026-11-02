import { nearestRoad } from './map.js';

// Дейкстра від цілі: для кожного вузла - відстань до цілі і ребро, яким туди йти.
// Граф маленький (~20 вузлів), тому простий O(N²) і кеш на карті.
function towards(map, target) {
  map._dj = map._dj || {};
  if (map._dj[target]) return map._dj[target];
  const N = map.nodes.length;
  const dist = new Array(N).fill(Infinity);
  const via = new Array(N).fill(-1);
  const done = new Array(N).fill(false);
  dist[target] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0) break;
    done[u] = true;
    for (const ei of map.nodes[u].adj) {
      const e = map.edges[ei];
      if (e.broken) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = dist[u] + e.len;
      if (nd < dist[v]) {
        dist[v] = nd;
        via[v] = ei;
      }
    }
  }
  return (map._dj[target] = { dist, via });
}

function finish(pts) {
  const cum = new Float64Array(pts.length);
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum[i] = L;
  }
  return { pts, cum, len: L };
}

// Маршрут від довільної точки до вузла-цілі по дорогах (зруйнований міст оминаємо)
export function planRoute(map, x, y, target) {
  const nr = nearestRoad(map, x, y, 2400);
  if (!nr) return null;
  const e = map.edges[nr.e];
  const { dist, via } = towards(map, target);
  let costA = nr.s;
  let costB = e.len - nr.s;
  if (e.broken) {
    if (nr.s < e.breakS) costB = Infinity;
    else costA = Infinity;
  }
  const optA = costA + dist[e.a];
  const optB = costB + dist[e.b];
  if (!Number.isFinite(Math.min(optA, optB))) return null;
  const goA = optA <= optB;
  // Точки маршруту - посилання на точки доріг, без нових об'єктів: маршрут перераховується кілька разів на секунду
  const pts = [];
  const push = (p) => pts.push(p);
  if (goA) for (let i = nr.i; i >= 0; i--) push(e.pts[i]);
  else for (let i = nr.i; i < e.pts.length; i++) push(e.pts[i]);
  let node = goA ? e.a : e.b;
  for (let guard = 0; node !== target && guard < 64; guard++) {
    const ed = map.edges[via[node]];
    if (!ed) break;
    if (ed.a === node) {
      for (let i = 1; i < ed.pts.length; i++) push(ed.pts[i]);
      node = ed.b;
    } else {
      for (let i = ed.pts.length - 2; i >= 0; i--) push(ed.pts[i]);
      node = ed.a;
    }
  }
  return finish(pts);
}

// Точка на маршруті на відстані d від початку (з дотичною). hint - індекс, з якого шукати.
export function pointAlong(route, d, hint = 0) {
  const { pts, cum } = route;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0, i: 0 };
  if (d <= 0) d = 0;
  if (d >= route.len) d = route.len - 0.001;
  let i = Math.max(0, Math.min(hint, pts.length - 2));
  if (cum[i] > d) i = 0;
  while (i < pts.length - 2 && cum[i + 1] < d) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const seg = cum[i + 1] - cum[i] || 1;
  const k = (d - cum[i]) / seg;
  const tx = (b.x - a.x) / seg;
  const ty = (b.y - a.y) / seg;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tx, ty, i };
}
