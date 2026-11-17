const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const $ = id => document.getElementById(id);

const ROUND = 30000;          // длительность раунда, мс
const LIFE = 1600;            // сколько живёт шарик, мс
const COUNT = 3;              // шариков на экране одновременно
const RMIN = 28, RMAX = 100;  // размеры шарика (радиус), поле 1920x1080

let targets = [], score = 0, hits = 0, shots = 0, react = [], t0 = 0, running = false;

const rand = (a, b) => a + Math.random() * (b - a);

function spawn(now) {
  const r = rand(RMIN, RMAX);
  let x, y, tries = 0;
  do {
    x = rand(r, cv.width - r);
    y = rand(r, cv.height - r);
  } while (++tries < 20 && targets.some(t => Math.hypot(t.x - x, t.y - y) < t.r + r + 10));
  targets.push({ x, y, r, born: now });
}

function start() {
  targets = []; score = hits = shots = 0; react = [];
  t0 = performance.now();
  running = true;
  $("overlay").hidden = true;
  requestAnimationFrame(loop);
}

function end() {
  running = false;
  const acc = shots ? Math.round(hits / shots * 100) : 0;
  const avg = react.length ? Math.round(react.reduce((a, b) => a + b) / react.length) : 0;
  let best = score;
  try {
    best = Math.max(+localStorage.getItem("best") || 0, score);
    localStorage.setItem("best", best);
  } catch {}
  $("title").textContent = "Раунд окончен";
  $("result").innerHTML =
    `Очки: <b>${score}</b>. Попаданий: ${hits}. Точность: ${acc}%. Средняя реакция: ${avg} мс.<br>Рекорд: ${best}`;
  $("btn").textContent = "Ещё раз";
  $("overlay").hidden = false;
}

function draw(now) {
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (const t of targets) {
    const k = 1 - (now - t.born) / LIFE;   // сколько жизни осталось (1 → 0)
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 7);
    ctx.fillStyle = "#2ecc40"; ctx.fill();
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.5, 0, 7);
    ctx.fillStyle = "#b7ff8a"; ctx.fill();
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r + 10, -Math.PI / 2, -Math.PI / 2 + Math.max(k, 0) * Math.PI * 2);
    ctx.strokeStyle = "#ffb000"; ctx.lineWidth = 6; ctx.stroke();
  }
}

function loop(now) {
  if (!running) return;
  const left = ROUND - (now - t0);
  if (left <= 0) return end();
  targets = targets.filter(t => now - t.born < LIFE);
  while (targets.length < COUNT) spawn(now);
  draw(now);
  $("time").textContent = (left / 1000).toFixed(1);
  $("score").textContent = score;
  requestAnimationFrame(loop);
}

cv.addEventListener("mousedown", e => {
  if (!running) return;
  const b = cv.getBoundingClientRect();
  const x = (e.clientX - b.left) * cv.width / b.width;
  const y = (e.clientY - b.top) * cv.height / b.height;
  shots++;
  const i = targets.findIndex(t => Math.hypot(t.x - x, t.y - y) <= t.r);
  if (i < 0) return;
  const t = targets[i];
  const age = Math.max(0, performance.now() - t.born);
  const size = (RMAX - t.r) / (RMAX - RMIN);   // 0 (большой) … 1 (маленький)
  const speed = Math.max(0, 1 - age / LIFE);   // 0 (медленно) … 1 (мгновенно)
  score += Math.round(10 + 20 * size + 20 * speed);
  hits++;
  react.push(age);
  targets.splice(i, 1);
});

$("btn").onclick = start;