// Параметры игры (должны совпадать с game.js)
const RMIN = 28, RMAX = 100, LIFE = 1600, ROUND = 30000, MIN_GAP = 150;

const enc = new TextEncoder();
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const cookie = (name, val, age, path = "/") =>
  `${name}=${val}; Path=${path}; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const getCookie = (req, name) =>
  (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1);

async function sign(env, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// id игрока из подписанной cookie сессии или null
async function uid(req, env) {
  const [id, exp, sig] = (getCookie(req, "s") || "").split(".");
  if (!id || !exp || !sig || Date.now() > +exp) return null;
  const good = await sign(env, `${id}.${exp}`);
  if (good.length !== sig.length || !crypto.subtle.timingSafeEqual(enc.encode(good), enc.encode(sig))) return null;
  return id;
}

function login(url, env) {
  const state = crypto.randomUUID();
  const q = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    redirect_uri: url.origin + "/auth/callback",
    response_type: "code",
    scope: "",
    state,
  });
  return new Response(null, {
    status: 302,
    headers: { location: "https://id.twitch.tv/oauth2/authorize?" + q, "set-cookie": cookie("st", state, 600, "/auth") },
  });
}

async function callback(req, url, env) {
  const code = url.searchParams.get("code");
  const state = getCookie(req, "st");
  if (!code || !state || state !== url.searchParams.get("state")) return new Response("Ошибка входа, попробуй ещё раз", { status: 400 });

  const tok = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: url.origin + "/auth/callback",
    }),
  }).then(r => r.json());
  if (!tok.access_token) return new Response("Twitch отклонил вход: " + (tok.message || tok.error || "") + " (" + (tok.status || "") + ")", { status: 400 });

  const u = (await fetch("https://api.twitch.tv/helix/users", {
    headers: { authorization: "Bearer " + tok.access_token, "client-id": env.TWITCH_CLIENT_ID },
  }).then(r => r.json())).data?.[0];
  if (!u) return new Response("Не удалось получить профиль Twitch", { status: 400 });

  await env.DB.prepare(
    "INSERT INTO players (twitch_id, name, avatar) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT(twitch_id) DO UPDATE SET name = ?2, avatar = ?3"
  ).bind(u.id, u.display_name, u.profile_image_url).run();

  const val = `${u.id}.${Date.now() + 30 * 864e5}`;
  const h = new Headers({ location: "/" });
  h.append("set-cookie", cookie("s", `${val}.${await sign(env, val)}`, 30 * 86400));
  h.append("set-cookie", cookie("st", "", 0, "/auth"));
  return new Response(null, { status: 302, headers: h });
}

async function me(req, env) {
  const id = await uid(req, env);
  if (!id) return json(null);
  return json(await env.DB.prepare("SELECT name, avatar, xp FROM players WHERE twitch_id = ?").bind(id).first());
}

async function start(req, env) {
  const id = await uid(req, env);
  if (!id) return json({ error: "login" }, 401);
  await env.DB.prepare("UPDATE players SET run_started = ? WHERE twitch_id = ?").bind(Date.now(), id).run();
  return json({ ok: true });
}

// Клиент присылает попадания [[t, r, age], ...]: время от старта, радиус, возраст шарика.
// Очки считает сервер сам и отбрасывает невозможные результаты.
async function finish(req, env) {
  const id = await uid(req, env);
  if (!id) return json({ error: "login" }, 401);
  const body = await req.json().catch(() => null);
  const hits = body?.hits, shots = body?.shots;
  const bad = () => json({ error: "bad" }, 400);
  if (!Array.isArray(hits) || hits.length > ROUND / MIN_GAP + 5 || !Number.isInteger(shots) || shots < hits.length || shots > 3000) return bad();

  let score = 0, prev = -1e9;
  for (const h of hits) {
    if (!Array.isArray(h) || h.length !== 3 || !h.every(Number.isFinite)) return bad();
    const [t, r, age] = h;
    if (t < 0 || t > ROUND + 1000 || t - prev < MIN_GAP) return bad();      // время и скорость кликов
    if (r < RMIN || r > RMAX || age < 0 || age > LIFE || age > t + 100) return bad();
    prev = t;
    score += Math.round(10 + 20 * (RMAX - r) / (RMAX - RMIN) + 20 * Math.max(0, 1 - age / LIFE));
  }

  // раунд засчитывается один раз и только если прошло примерно 30 секунд
  const now = Date.now();
  const claim = await env.DB.prepare(
    "UPDATE players SET run_started = NULL WHERE twitch_id = ?1 AND run_started BETWEEN ?2 AND ?3"
  ).bind(id, now - 70000, now - 29000).run();
  if (!claim.meta.changes) return json({ error: "time" }, 400);

  await env.DB.batch([
    env.DB.prepare("UPDATE players SET xp = xp + ?1 WHERE twitch_id = ?2").bind(score, id),
    env.DB.prepare("INSERT INTO runs (twitch_id, score, hits, shots) VALUES (?1, ?2, ?3, ?4)").bind(id, score, hits.length, shots),
  ]);
  const p = await env.DB.prepare("SELECT xp FROM players WHERE twitch_id = ?").bind(id).first();
  return json({ score, xp: p.xp });
}

async function leaderboard(env) {
  const { results } = await env.DB.prepare(
    "SELECT name, avatar, xp FROM players WHERE xp > 0 ORDER BY xp DESC LIMIT 50"
  ).all();
  return json(results);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    try {
      if (p === "/auth/login") return login(url, env);
      if (p === "/auth/callback") return await callback(req, url, env);
      if (p === "/auth/logout" && req.method === "POST")
        return new Response(null, { status: 204, headers: { "set-cookie": cookie("s", "", 0) } });
      if (p === "/api/me") return await me(req, env);
      if (p === "/api/start" && req.method === "POST") return await start(req, env);
      if (p === "/api/finish" && req.method === "POST") return await finish(req, env);
      if (p === "/api/leaderboard") return await leaderboard(env);
    } catch (e) {
      console.error(e);
      return json({ error: "server" }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};
