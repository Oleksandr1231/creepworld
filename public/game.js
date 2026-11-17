const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const $ = id => document.getElementById(id);

const ROUND = 30000;          // длительность раунда, мс (как на сервере)
const LIFE = 1600;            // сколько живёт шарик, мс
const COUNT = 3;              // шариков на экране одновременно
const RMIN = 28, RMAX = 100;  // размеры шарика (радиус), поле 1920x1080

let targets = [], score = 0, hits = [], shots = 0, t0 = 0;
let running = false, busy = false, me = null;

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- игра ---------- */

function spawn(now) {
  const r = rand(RMIN, RMAX);
  let x, y, tries = 0;
  do {
    x = rand(r, cv.width - r);
    y = rand(r, cv.height - r);
  } while (++tries < 20 && targets.some(t => Math.hypot(t.x - x, t.y - y) < t.r + r + 10));
  targets.push({ x, y, r, born: now });
}

async function start() {
  if (busy || running) return;
  busy = true;
  $("btn").disabled = true;
  if (me) await fetch("/api/start", { method: "POST" }).catch(() => {});
  targets = []; score = shots = 0; hits = [];
  $("overlay").hidden = true;
  $("btn").disabled = false;
  $("stage").classList.add("playing");
  busy = false;
  running = true;
  t0 = performance.now();
  requestAnimationFrame(loop);
}

async function end() {
  running = false;
  $("stage").classList.remove("playing");
  const n = hits.length;
  const acc = shots ? Math.round(n / shots * 100) : 0;
  const avg = n ? Math.round(hits.reduce((a, h) => a + h[2], 0) / n) : 0;
  $("title").textContent = "Раунд окончен";
  $("result").innerHTML = `Очки: <b>${score}</b>. Попаданий: ${n}. Точность: ${acc}%. Средняя реакция: ${avg} мс.`;
  $("saved").textContent = me ? "Сохраняю результат…" : "Войди через Twitch, чтобы результат попал в рейтинг.";
  $("btn").textContent = "Ещё раз";
  $("overlay").hidden = false;
  if (!me) return;
  try {
    const r = await fetch("/api/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hits, shots }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    me.xp = d.xp;
    $("saved").textContent = `Сохранено: +${d.score} опыта.`;
    renderUser();
    loadBoard();
  } catch {
    $("saved").textContent = "Не удалось сохранить результат.";
  }
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
  const now = performance.now();
  const t = targets[i];
  const r = Math.round(t.r);
  const age = Math.min(LIFE, Math.max(0, Math.round(now - t.born)));
  // те же формулы, что на сервере: очки считает сервер, здесь только для показа
  score += Math.round(10 + 20 * (RMAX - r) / (RMAX - RMIN) + 20 * Math.max(0, 1 - age / LIFE));
  hits.push([Math.round(now - t0), r, age]);   // [время от старта, радиус, возраст шарика]
  targets.splice(i, 1);
});

$("btn").onclick = start;

/* ---------- аккаунт и рейтинг ---------- */

function hint() {
  $("saved").textContent = me
    ? "Результаты сохраняются в рейтинге."
    : "Войди через Twitch, чтобы опыт шёл в рейтинг. Играть можно и без входа.";
}

function renderUser() {
  const box = $("user");
  box.replaceChildren();
  if (!me) {
    const a = document.createElement("a");
    a.href = "/auth/login";
    a.className = "login";
    a.textContent = "Войти через Twitch";
    box.append(a);
    return;
  }
  const img = new Image();
  img.alt = "";
  if (me.avatar) img.src = me.avatar;
  const name = document.createElement("span");
  name.textContent = me.name;
  const xp = document.createElement("b");
  xp.textContent = me.xp + " XP";
  const out = document.createElement("button");
  out.className = "link";
  out.textContent = "Выйти";
  out.onclick = async () => {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    me = null;
    renderUser();
    hint();
    loadBoard();
  };
  box.append(img, name, xp, out);
}

async function loadBoard() {
  try {
    const rows = await fetch("/api/leaderboard").then(r => r.json());
    const ol = $("rows");
    ol.replaceChildren();
    $("empty").hidden = rows.length > 0;
    for (const p of rows) {
      const li = document.createElement("li");
      if (me && p.name === me.name) li.className = "me";
      const img = new Image();
      img.alt = "";
      if (p.avatar) img.src = p.avatar;
      const n = document.createElement("span");
      n.textContent = p.name;
      const x = document.createElement("b");
      x.textContent = p.xp + " XP";
      li.append(img, n, x);
      ol.append(li);
    }
  } catch {}
}

fetch("/api/me")
  .then(r => r.json())
  .then(u => { me = u; })
  .catch(() => {})
  .finally(() => { renderUser(); hint(); loadBoard(); });
  