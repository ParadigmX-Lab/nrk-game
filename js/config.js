// Усі числа балансу в одному місці. Одиниці: світові пікселі, секунди, відсотки заряду.
// Базові значення - рівень «АКТИВНО». Інші рівні складності нижче лише перекривають потрібні числа.
export const CFG = {
  world: { w: 7600, h: 3600 },
  metersPerPx: 0.25,
  viewH: 400, // скільки світових пікселів видно по вертикалі
  maxDpr: 2,

  road: { width: 84 },

  robot: {
    maxSpeed: 80,
    accel: 110,
    brake: 200,
    turnRate: 2.3,
    loadedFactor: 0.88,
    cargoKg: 40,
  },

  terrain: { road: 1.0, shoulder: 0.62, field: 0.4, mud: 0.45, crater: 0.55 },
  shoulderWidth: 40, // скільки пікселів за краєм дороги ще вважається узбіччям

  dash: { mult: 2.6, time: 0.55, cooldown: 6, cost: 2 },

  // mult - загальний множник витрати (складність)
  battery: { idle: 0.06, move: 0.17, loadedMult: 1.15, offroadMult: 1.6, reb: 1.0, leak: 0.12, mult: 1 },

  reb: { radius: 210, maxOn: 6, overheatCd: 5 },

  scan: { radius: 220, cooldown: 6, cost: 0.6 },

  integrity: 4,

  baseRadius: 75,
  robotRadius: 18, // для зіткнень зі стовбурами й технікою

  // Провис сітки: НРК заплутується і сильно гальмує
  tangle: { time: 3.2, speed: 0.28, cooldown: 4, dashCut: 1.6 },

  fpv: {
    speed: 128,
    fiberSpeed: 106,
    spawnDist: 640,
    detectRange: 520,
    fiberDetect: 290,
    acquire: 330,
    diveDist: 135,
    diveTime: 0.85,
    hitRadius: 26,
    homing: 28,
    searchTime: 5.5,
    cruiseZ: 40,
  },

  // Скільки дронів одночасно і яких: high - ближче до фронту (небезпека > highAt), front - біля самого ОП
  spawn: { maxLow: 1, maxHigh: 2, highAt: 0.45, maxFront: 2, frontAt: 0.75, bomber: 0.33, fiber: 0.33, fiberAt: 0.35 },

  // Дрон зі скидами: висить над ціллю й кидає гранати, а якщо НРК сховався - мінує дорогу
  bomber: { speed: 80, z: 95, detect: 600, drops: 3, aimTime: 1.0, fallTime: 1.15, blast: 28, coverWait: 4 },

  // Арта: фонові прильоти + пристрілка, якщо довго світишся (засвітка > aimedAt) чи стоїш.
  // salvo 2 - «вилка»: перший приліт поруч, другий - туди, де НРК тепер
  shell: { warn: 1.5, blast: 38, ambientMin: 6, ambientMax: 13, aimedMin: 10, aimedMax: 17, aimedAt: 75, salvo: 1 },

  // Ждуни: FPV, що лежать на узбіччі й злітають, коли НРК поруч. СКАН їх показує
  ambush: { count: 3, fiber: 0, wake: 150, rise: 0.5, hint: 0.6 },

  // Міни на дорогах: скільки, яка частка вже позначена, наскільки помітна перекопана земля
  mines: { road: [18, 24], known: 0.3, hint: 1 },

  nets: { count: [4, 5], sags: [1, 3] },
  rebZones: 4,

  traffic: { firstAt: 25, min: 38, max: 75 },

  // Зміна завдання: шанс на рейс (кидається заново щоразу) і на якій частці шляху вона стається
  task: { chance: 0.3, from: 0.3, to: 0.6 },

  // Тил: ближче до бази дрони не долітають і повертаються на схід
  rearDanger: 0.12,

  exposure: {
    mult: 1.2,
    openMove: 3.6,
    openStill: 5,
    cover: -9,
    loiter: 4,
    spawnAt: 100,
    resetTo: 40,
    grace: 12,
    maxGap: 26,
  },

  signal: { delayPerBar: 0.11 },
};

// ---------- Рівні складності ----------
export const LEVELS = [
  {
    id: 'easy',
    name: 'ТИХО',
    title: 'Тихий напрямок',
    color: '#8BF28A',
    desc: 'Для знайомства з грою. Дронів мало, більше половини мін уже позначено, РЕБ і скан сильніші, ждунів немає.',
    cfg: {
      integrity: 6,
      battery: { mult: 0.85, reb: 0.8 },
      dash: { cooldown: 5 },
      reb: { radius: 230, maxOn: 7, overheatCd: 4 },
      scan: { radius: 240, cooldown: 5, cost: 0.5 },
      fpv: { speed: 112, fiberSpeed: 95, diveTime: 1.05, homing: 18, searchTime: 4.5 },
      spawn: { maxHigh: 1, maxFront: 1, fiber: 0.12, fiberAt: 0.5 },
      bomber: { speed: 70, aimTime: 1.3, blast: 26, coverWait: 5 },
      shell: { warn: 1.9, ambientMin: 9, ambientMax: 18, aimedMin: 14, aimedMax: 22, aimedAt: 90 },
      ambush: { count: 0 },
      mines: { road: [12, 16], known: 0.6 },
      nets: { count: [5, 6], sags: [1, 2] },
      rebZones: 3,
      task: { chance: 0.15 },
      exposure: { mult: 0.8, resetTo: 25, grace: 18, maxGap: 40 },
      signal: { delayPerBar: 0.09 },
    },
  },
  {
    id: 'normal',
    name: 'АКТИВНО',
    title: 'Активний напрямок',
    color: '#FFC845',
    desc: 'Звичайний виїзд. Мін і дронів більше, більшість мін доведеться шукати сканом, трапляються ждуни.',
    cfg: {},
  },
  {
    id: 'hard',
    name: 'ГАРЯЧЕ',
    title: 'Гарячий напрямок',
    color: '#FF8A3D',
    desc: 'Дрони парами, часто оптоволокно, яке не бере РЕБ. Ждунів більше, арта б\'є «вилкою», сіток менше.',
    cfg: {
      integrity: 4,
      battery: { mult: 1.0, reb: 1.2 },
      reb: { radius: 190, maxOn: 5, overheatCd: 6 },
      scan: { radius: 210, cooldown: 7.5, cost: 0.8 },
      fpv: { speed: 134, fiberSpeed: 110, diveTime: 0.8, homing: 30, searchTime: 7, detectRange: 480, fiberDetect: 260 },
      spawn: { highAt: 0.4, fiber: 0.38, fiberAt: 0.3 },
      bomber: { speed: 86, aimTime: 0.85, drops: 4, blast: 30, coverWait: 3.5 },
      shell: { warn: 1.4, ambientMin: 5, ambientMax: 11, aimedMin: 9, aimedMax: 15, aimedAt: 85, salvo: 2 },
      ambush: { count: 4, fiber: 0.15, hint: 0.45 },
      mines: { road: [20, 26], known: 0.2, hint: 0.85 },
      nets: { count: [3, 4], sags: [2, 3] },
      rebZones: 5,
      task: { chance: 0.45 },
      exposure: { mult: 1.3, resetTo: 45, grace: 9, maxGap: 22 },
      signal: { delayPerBar: 0.13 },
    },
  },
  {
    id: 'hell',
    name: 'ПЕКЛО',
    title: 'Пекло',
    color: '#FF5A4E',
    desc: 'Міни майже не позначені, біля ОП - до трьох дронів одразу, ждуни на оптоволокні, мало часу на реакцію.',
    cfg: {
      integrity: 3,
      battery: { mult: 1.05, reb: 1.25 },
      dash: { cooldown: 6.5 },
      reb: { radius: 180, maxOn: 4.5, overheatCd: 7 },
      scan: { radius: 210, cooldown: 7, cost: 0.9 },
      fpv: { speed: 140, fiberSpeed: 116, diveTime: 0.78, homing: 30, searchTime: 8.5, detectRange: 450, fiberDetect: 240 },
      spawn: { maxHigh: 2, highAt: 0.35, maxFront: 3, frontAt: 0.75, bomber: 0.35, fiber: 0.42, fiberAt: 0.2 },
      bomber: { speed: 94, aimTime: 0.75, drops: 5, blast: 32, coverWait: 3 },
      shell: { warn: 1.25, ambientMin: 4, ambientMax: 9, aimedMin: 7, aimedMax: 12, aimedAt: 80, salvo: 2 },
      ambush: { count: 6, fiber: 0.35, hint: 0.32 },
      mines: { road: [18, 24], known: 0.05, hint: 0.75 },
      nets: { count: [2, 3], sags: [2, 4] },
      rebZones: 6,
      task: { chance: 0.6 },
      exposure: { mult: 1.45, resetTo: 50, grace: 7, maxGap: 18 },
      signal: { delayPerBar: 0.15 },
    },
  },
];

const BASE = JSON.parse(JSON.stringify(CFG));

function merge(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
      merge(dst[k], v);
    } else dst[k] = Array.isArray(v) ? v.slice() : v;
  }
}

// Перезбирає CFG: база + перекриття рівня. Викликати до генерації карти (game.reset/start)
export function setDifficulty(id) {
  const lvl = LEVELS.find((l) => l.id === id) || LEVELS[1];
  const fresh = JSON.parse(JSON.stringify(BASE));
  for (const k of Object.keys(CFG)) delete CFG[k];
  Object.assign(CFG, fresh);
  merge(CFG, lvl.cfg);
  CFG.level = { id: lvl.id, name: lvl.name, title: lvl.title, color: lvl.color };
  return lvl;
}

setDifficulty('normal');
