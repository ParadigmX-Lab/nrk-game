// Гра завжди горизонтальна.
// Android: тап по кнопці -> повний екран + блокування в landscape (спрацьовує навіть з вимкненим автоповоротом).
// iPhone і там, де блокування немає: гра сама повертається на 90° CSS-трансформом, телефон тримають боком.
// rot: 0 - як є, 90 - верх гри до правого краю екрана, -90 - до лівого.
export const view = { rot: 0, sw: 0, sh: 0, w: 0, h: 0 };

// Координати пальця на екрані -> координати всередині гри
export function toLocal(cx, cy) {
  if (view.rot === 90) return { x: cy, y: view.sw - cx };
  if (view.rot === -90) return { x: view.sh - cy, y: cx };
  return { x: cx, y: cy };
}

export function applyLayout(app, rot) {
  const sw = window.innerWidth;
  const sh = window.innerHeight;
  view.sw = sw;
  view.sh = sh;
  view.rot = rot;
  app.classList.toggle('rot', rot !== 0);
  app.classList.toggle('rot90', rot === 90);
  app.classList.toggle('rotm90', rot === -90);
  if (rot) {
    app.style.width = `${sh}px`;
    app.style.height = `${sw}px`;
    app.style.transform = rot === 90 ? `translateX(${sw}px) rotate(90deg)` : `translateY(${sh}px) rotate(-90deg)`;
    view.w = sh;
    view.h = sw;
  } else {
    app.style.width = '';
    app.style.height = '';
    app.style.transform = '';
    view.w = sw;
    view.h = sh;
  }
  // Класи замість @media: медіазапити міряють екран, а не повернуту гру
  app.classList.toggle('narrow', view.w <= 720);
  app.classList.toggle('short', view.h <= 400);
  app.classList.toggle('tiny', view.h <= 370);
}
