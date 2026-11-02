import { Game } from './game.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { hashString } from './rng.js';
import { todayKey, fmtTime } from './util.js';
import { drawTactical, tacticalInfo, tacticalTransform } from './tacmap.js';
import { CFG, LEVELS, setDifficulty } from './config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';

const sfx = new Sfx();
const hud = new Hud();
const renderer = new Renderer($('view'));
const input = new Input({
  touch: $('touch'),
  joy: $('joy'),
  knob: $('knob'),
  btnDash: $('btnDash'),
  btnReb: $('btnReb'),
  btnScan: $('btnScan'),
});

// localStorage може бути недоступний (приватний режим) - тоді просто не запам'ятовуємо
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* нічого */
    }
  },
};

// ---------- Складність: обрана й пройдені ----------
const doneLevels = new Set(
  (() => {
    try {
      const a = JSON.parse(store.get('nrk.done', '[]'));
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  })(),
);
// Новачок починає з «ТИХО»: результат рейсу підкаже наступний рівень
let level = setDifficulty(store.get('nrk.level', 'easy'));

// ---------- Вибір карти ----------
const day = todayKey();
const dailyMap = () => ({ seed: hashString('nrk-' + day.key), label: `Маршрут дня · ${day.short}`, share: `Маршрут дня ${day.full}` });
const randomMap = () => {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return { seed: hashString('nrk-rand-' + n), label: `Випадкова карта #${n}`, share: `Карта #${n}` };
};
let mapInfo = dailyMap();
if (params.get('seed')) {
  const sd = params.get('seed').slice(0, 24);
  mapInfo = { seed: hashString('nrk-custom-' + sd), label: `Карта «${sd}»`, share: `Карта «${sd}»` };
}

const game = new Game({
  sfx,
  onToast: (t, k) => hud.toast(t, k),
  onEnd: (res) => showResult(res),
});
game.load(mapInfo.seed, mapInfo.label);
$('mRoute').textContent = mapInfo.label;

function buildDiff() {
  const box = $('diffSeg');
  box.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.id = l.id;
    b.style.setProperty('--lvl', l.color);
    const name = document.createElement('span');
    name.textContent = l.name;
    const heat = document.createElement('span');
    heat.className = 'heat';
    for (let k = 0; k < LEVELS.length; k++) {
      const bar = document.createElement('i');
      if (k <= i) bar.className = 'on';
      heat.appendChild(bar);
    }
    b.append(name, heat);
    if (doneLevels.has(l.id)) {
      const d = document.createElement('span');
      d.className = 'done';
      d.textContent = '✓';
      d.title = 'Пройдено';
      b.appendChild(d);
    }
    b.addEventListener('click', () => selectLevel(l.id));
    box.appendChild(b);
  });
  updateDiffUI();
}

function updateDiffUI() {
  for (const b of $('diffSeg').children) b.setAttribute('aria-checked', String(b.dataset.id === level.id));
  const desc = $('diffDesc');
  desc.style.setProperty('--lvl', level.color);
  desc.innerHTML = '';
  const t = document.createElement('b');
  t.textContent = `${level.title}. `;
  // Скільки влучань витримає НРК - з конфігу рівня, щоб текст не розходився з балансом
  const n = CFG.integrity;
  const word = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'влучання' : 'влучань';
  desc.append(t, document.createTextNode(`${level.desc} НРК витримає ${n} ${word}.`));
  $('capLvl').textContent = level.name;
  $('capLvl').style.color = level.color;
}

// Рівень міняє і баланс, і карту (кількість мін, сіток, РЕБ, ждунів) - тому перегенеровуємо
function selectLevel(id) {
  if (id === level.id) return;
  sfx.init();
  sfx.click();
  level = setDifficulty(id);
  store.set('nrk.level', id);
  game.reset();
  renderer.snapCamera();
  updateDiffUI();
}
buildDiff();

// ---------- Режими інтерфейсу ----------
const screens = { menu: $('scrStart'), pause: $('scrPause'), result: $('scrResult'), map: $('scrMap') };

function setMode(mode) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== mode);
  const playing = mode === 'play';
  $('hud').classList.toggle('hidden', !(playing || mode === 'pause'));
  $('controls').classList.toggle('hidden', !playing);
  $('joy').classList.toggle('hidden', !playing);
  input.setEnabled(playing);
  if (playing) input.placeIdle();
}

async function goFullscreen() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse || document.fullscreenEnabled === false) return;
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch (e) {
    /* iPhone не вміє - це нормально */
  }
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) {
    /* не всі браузери дозволяють */
  }
}

function startRun() {
  sfx.init();
  sfx.click();
  goFullscreen();
  hud.reset();
  game.start();
  renderer.snapCamera();
  setMode('play');
}

// У вбудованому вікні (iframe) повний екран зазвичай заборонений - кнопку не показуємо
function canFullscreen() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse && document.fullscreenEnabled !== false && !!document.documentElement.requestFullscreen;
}

function updateFsButton() {
  $('btnFs').hidden = !canFullscreen() || !!document.fullscreenElement;
}

function pause() {
  if (game.state !== 'play' || game.result) return;
  game.state = 'paused';
  sfx.rebOff();
  setMode('pause');
  updateFsButton();
}

// Тактична карта: за замовчуванням фрагмент навколо НРК, тягни пальцем, щоб подивитись далі
const tacView = { full: false, cx: 0, cy: 0, span: 2600 };

function openMap() {
  if (game.state !== 'play' || game.result) return;
  sfx.click();
  // Якщо штаб змінив завдання - саме тут оператор його бачить і маршрут перебудовується
  const t = game.task;
  const oldName = t.next !== null ? game.map.ops[t.op].name : null;
  const changed = game.ackTask();
  const box = $('tTask');
  if (changed) {
    box.hidden = false;
    box.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = `НОВЕ ЗАВДАННЯ: БК на ОП «${game.map.ops[t.op].name}».`;
    box.appendChild(b);
    box.appendChild(document.createTextNode(` ОП «${oldName}» під обстрілом. Маршрут перебудовано.`));
  } else box.hidden = true;
  game.state = 'paused';
  sfx.rebOff();
  tacView.cx = game.robot.x;
  tacView.cy = game.robot.y;
  setMode('map');
  updateViewBtn();
  requestAnimationFrame(drawMap);
}

function updateViewBtn() {
  $('btnMapView').textContent = tacView.full ? 'ПОРУЧ З НРК' : 'ВЕСЬ РАЙОН';
}

function drawMap() {
  const c = $('tacCanvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawTactical(ctx, game, w, h, tacView);
  const info = tacticalInfo(game);
  $('tSq').textContent = info.sq;
  const body = $('tPts');
  body.innerHTML = '';
  for (const row of info.rows) {
    const tr = document.createElement('tr');
    if (row.cls) tr.className = row.cls;
    for (const v of [row.name, row.X, row.Y, row.dist]) {
      const td = document.createElement('td');
      td.textContent = String(v);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function resume() {
  sfx.init();
  // Після згортання браузера повний екран злітає; повернути його можна лише по натисканню - тобто тут
  goFullscreen();
  game.state = 'play';
  if (game.robot.reb.on) sfx.rebOn();
  setMode('play');
}

function toMenu() {
  sfx.rebOff();
  game.reset();
  game.state = 'menu';
  renderer.snapCamera();
  hud.reset();
  setMode('menu');
}

function newMap() {
  mapInfo = randomMap();
  game.load(mapInfo.seed, mapInfo.label);
  $('mRoute').textContent = mapInfo.label;
  renderer.snapCamera();
}

let shareText = '';

function showResult(res) {
  setMode('result');
  const sc = screens.result;
  sc.classList.remove('win', 'lose', 'power');
  let title;
  let text;
  let mark;
  if (res.reason === 'success') {
    sc.classList.add('win');
    title = 'РЕЙС ВИКОНАНО';
    mark = '✅';
    text = res.delivered >= res.cargoMax
      ? `БК на ОП «${res.opName}», НРК повернувся на базу. Хлопці кажуть дякую.`
      : res.delivered > 0
        ? 'Частину вантажу втрачено, але решта дійшла. НРК на базі.'
        : 'Вантаж не вцілів, але комплекс повернувся на базу.';
  } else if (res.reason === 'battery') {
    sc.classList.add('power');
    title = 'НРК ЗНЕСТРУМЛЕНО';
    mark = '🔋';
    text = 'Комплекс став у сірій зоні. Наступного разу економ заряд: менше РЕБ і простоїв.';
  } else {
    sc.classList.add('lose');
    title = 'НРК ВТРАЧЕНО';
    mark = '❌';
    text = res.phase === 'return'
      ? 'Вантаж доставлено, але комплекс знищено на зворотному шляху.'
      : 'Вантаж не дійшов до ОП. Тримайся дороги, ховайся під крони й сітки, бережи РИВОК для FPV.';
  }
  $('rKicker').textContent = `${mapInfo.label} · ${level.name}`;
  const next = $('rNext');
  next.hidden = true;
  // Рівень зараховано, якщо НРК повернувся і хоч частина БК дійшла
  if (res.reason === 'success' && res.delivered > 0) {
    const first = !doneLevels.has(level.id);
    doneLevels.add(level.id);
    store.set('nrk.done', JSON.stringify([...doneLevels]));
    buildDiff();
    const idx = LEVELS.findIndex((l) => l.id === level.id);
    if (first && idx < LEVELS.length - 1) {
      next.hidden = false;
      next.textContent = `Рівень «${level.name}» пройдено! Далі - «${LEVELS[idx + 1].name}», обирай у меню`;
    } else if (first) {
      next.hidden = false;
      next.textContent = 'ПЕКЛО пройдено. Повага, оператор!';
    }
  }
  $('rTitle').textContent = title;
  $('rText').textContent = text;
  $('rTime').textContent = fmtTime(res.time);
  $('rCargo').textContent = `${res.delivered}/${res.cargoMax} кг`;
  $('rHits').textContent = String(res.hits);
  $('rBatt').textContent = `${res.battery}%`;
  $('btnShare').textContent = 'ПОДІЛИТИСЯ';
  shareText = [
    `НРК: Остання миля · ${level.name} · ${mapInfo.share} · ОП «${res.opName}»`,
    `${mark} ${title.charAt(0) + title.slice(1).toLowerCase()} · ${fmtTime(res.time)}`,
    `Вантаж ${res.delivered}/${res.cargoMax} кг · Влучань ${res.hits} · Заряд ${res.battery}%`,
  ].join('\n');
}

async function share() {
  sfx.click();
  try {
    if (navigator.share) {
      await navigator.share({ text: shareText });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(shareText);
    ok = true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = shareText;
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    ta.remove();
  }
  $('btnShare').textContent = ok ? 'СКОПІЙОВАНО ✓' : 'НЕ ВДАЛОСЯ';
}

function updateSoundLabel() {
  $('btnSound').textContent = sfx.muted ? 'ЗВУК: ВИМК' : 'ЗВУК: УВІМК';
}

// ---------- Кнопки ----------
$('btnStart').addEventListener('click', startRun);
$('btnNewMap').addEventListener('click', () => {
  sfx.init();
  sfx.click();
  newMap();
});
$('btnPause').addEventListener('click', pause);
$('minimap').addEventListener('click', openMap);
$('btnMapClose').addEventListener('click', resume);
$('btnMapView').addEventListener('click', () => {
  tacView.full = !tacView.full;
  tacView.cx = game.robot.x;
  tacView.cy = game.robot.y;
  updateViewBtn();
  drawMap();
});
{
  const c = $('tacCanvas');
  let drag = null;
  c.addEventListener('pointerdown', (e) => {
    if (tacView.full) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      c.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ок */
    }
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { s } = tacticalTransform(game, c.clientWidth, c.clientHeight, tacView);
    tacView.cx -= (e.clientX - drag.x) / s;
    tacView.cy -= (e.clientY - drag.y) / s;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drawMap();
  });
  const end = () => (drag = null);
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}
$('btnResume').addEventListener('click', resume);
$('btnFs').addEventListener('click', async () => {
  await goFullscreen();
  updateFsButton();
});
document.addEventListener('fullscreenchange', () => {
  updateFsButton();
  setTimeout(onResize, 100);
});
$('btnRestart').addEventListener('click', startRun);
$('btnMenu').addEventListener('click', toMenu);
$('btnSound').addEventListener('click', () => {
  sfx.setMuted(!sfx.muted);
  updateSoundLabel();
});
$('btnAgain').addEventListener('click', startRun);
$('btnShare').addEventListener('click', share);
$('btnResNew').addEventListener('click', () => {
  newMap();
  startRun();
});
$('btnResMenu').addEventListener('click', () => {
  sfx.click();
  toMenu();
});
updateSoundLabel();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && game.state === 'menu') startRun();
});

// ---------- Системне ----------
const onResize = () => {
  renderer.resize();
  input.placeIdle();
  if (!screens.map.classList.contains('hidden')) drawMap();
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
$('app').addEventListener('contextmenu', (e) => e.preventDefault());

const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
let embedded = false;
try {
  embedded = window.self !== window.top;
} catch (e) {
  embedded = true;
}
if (isIOS && !standalone && !embedded) $('iosHint').hidden = false;

if (DEBUG) {
  $('fps').hidden = false;
  window.game = game;
  window.renderer = renderer;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/eruda@3.0.1/eruda.js';
  s.onload = () => window.eruda && window.eruda.init();
  document.head.appendChild(s);
}

// ---------- Ігровий цикл ----------
setMode('menu');
let last = performance.now();
// Слабкий телефон: якщо 3 с гри поспіль менше ~38 FPS - знижуємо роздільність канви.
// Лише вниз і максимум двічі, щоб картинка не «дихала»
const perf = { t: 0, n: 0, bad: 0 };
function watchPerf(raw) {
  if (game.state !== 'play' || raw > 0.2) {
    perf.t = 0;
    perf.n = 0;
    return;
  }
  perf.t += raw;
  perf.n++;
  if (perf.t < 3) return;
  const avg = perf.t / perf.n;
  perf.t = 0;
  perf.n = 0;
  perf.bad = avg > 1 / 38 ? perf.bad + 1 : 0;
  if (perf.bad >= 2 && renderer.dpr > 1) {
    perf.bad = 0;
    renderer.dprCap = renderer.dpr > 1.5 ? 1.5 : 1;
    renderer.resize();
  }
}
function frame(now) {
  const raw = Math.max(0, (now - last) / 1000);
  const dt = Math.min(0.05, raw);
  last = now;
  watchPerf(raw);
  if (game.state === 'play') {
    game.tick(dt, input);
    if (game.requestPause) {
      game.requestPause = false;
      pause();
    }
    if (game.requestMap) {
      game.requestMap = false;
      openMap();
    }
  }
  renderer.render(game, game.state === 'paused' ? 0 : dt);
  if (game.state === 'play' || game.state === 'paused') hud.update(game, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
