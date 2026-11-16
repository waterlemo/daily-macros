import { hasAmount, validAmounts, validDate } from "../docs/domain.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const githubApi = "https://api.github.com";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function base64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

const fromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const urlSafe = bytes => base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromUrlSafe = value => fromBase64(value.replaceAll("-", "+").replaceAll("_", "/"));
const digest = value => crypto.subtle.digest("SHA-256", encoder.encode(value));
const challengeFor = async verifier => urlSafe(new Uint8Array(await digest(verifier)));

function settings(env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !/^\d+$/.test(env.GITHUB_USER_ID || "") ||
      !/^[\w-]+\/[\w.-]+$/.test(env.DATA_REPOSITORY || "") || !challengePattern.test(env.SESSION_KEY || "")) {
    throw new HttpError(503, "登录服务尚未配置。");
  }
  const site = new URL(env.SITE_URL);
  if (site.protocol !== "https:" || site.search || site.hash || site.username || site.password) {
    throw new HttpError(503, "网站地址配置不正确。");
  }
  return {
    site, repo: "/repos/" + env.DATA_REPOSITORY,
    userId: env.GITHUB_USER_ID, clientId: env.GITHUB_CLIENT_ID,
    secret: env.GITHUB_CLIENT_SECRET,
    key: crypto.subtle.importKey("raw", fromUrlSafe(env.SESSION_KEY), "AES-GCM", false, ["encrypt", "decrypt"])
  };
}

async function seal(config, purpose, value, seconds) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, await config.key,
    encoder.encode(JSON.stringify({ ...value, expires: Date.now() + seconds * 1000 }))
  );
  return urlSafe(iv) + "." + urlSafe(new Uint8Array(data));
}

async function open(config, purpose, envelope) {
  try {
    if (typeof envelope !== "string" || envelope.length > 4096) return null;
    const [iv, ciphertext, extra] = envelope.split(".");
    if (extra !== undefined || !iv || !ciphertext) return null;
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromUrlSafe(iv), additionalData: encoder.encode(purpose) },
      await config.key, fromUrlSafe(ciphertext)
    );
    const parsed = JSON.parse(decoder.decode(data));
    return parsed.expires > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

function github(path, token, options = {}) {
  return fetch(githubApi + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "User-Agent": "daily-macros",
      "X-GitHub-Api-Version": "2026-03-10",
      ...options.headers
    }
  });
}

function githubError(status) {
  if (status === 401) return new HttpError(401, "GitHub 登录已过期，请重新登录。");
  if (status === 403 || status === 429) return new HttpError(502, "GitHub 暂时拒绝请求，请确认应用权限或稍后再试。");
  return new HttpError(502, "暂时无法访问 GitHub 数据仓库，请检查应用安装和仓库设置。");
}

async function checkRepo(config, token) {
  const response = await github(config.repo, token);
  if (!response.ok) throw githubError(response.status);
  if (!(await response.json()).private) throw new HttpError(502, "请将数据仓库设为私有。");
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: String(location), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
  });
}

function sendToSite(config, name, value) {
  const destination = new URL(config.site);
  destination.hash = new URLSearchParams({ [name]: value }).toString();
  return redirect(destination);
}

function callbackUrl(url) {
  return new URL("/auth/callback", url).href;
}

async function startLogin(config, url) {
  const challenge = url.searchParams.get("challenge");
  if (!challengePattern.test(challenge || "")) throw new HttpError(400, "请从网站登录。");
  const verifier = urlSafe(crypto.getRandomValues(new Uint8Array(32)));
  const destination = new URL("https://github.com/login/oauth/authorize");
  destination.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(url),
    state: await seal(config, "github-state", { challenge, verifier }, 600),
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256"
  }).toString();
  return redirect(destination);
}

async function finishGithubLogin(config, url) {
  const state = await open(config, "github-state", url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.has("error")) return sendToSite(config, "auth_error", "cancelled");
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.secret,
        redirect_uri: callbackUrl(url), code, code_verifier: state.verifier
      })
    });
    const auth = await response.json();
    if (!response.ok || !auth.access_token) return sendToSite(config, "auth_error", "cancelled");
    const userResponse = await github("/user", auth.access_token);
    if (!userResponse.ok) return sendToSite(config, "auth_error", "cancelled");
    const user = await userResponse.json();
    if (String(user.id) !== config.userId) return sendToSite(config, "auth_error", "denied");
    const ttl = Math.min(Number(auth.expires_in) || 28800, 28800);
    const session = await seal(config, "session", { token: auth.access_token, userId: config.userId }, ttl);
    const handoff = await seal(config, "handoff", { session, account: user.login, challenge: state.challenge }, 90);
    return sendToSite(config, "handoff", handoff);
  } catch {
    return sendToSite(config, "auth_error", "cancelled");
  }
}

async function claim(config, body) {
  const pending = await open(config, "handoff", body.handoff);
  if (!pending || !challengePattern.test(body.verifier || "") || await challengeFor(body.verifier) !== pending.challenge) {
    throw new HttpError(401, "登录链接已失效，请重新登录。");
  }
  const session = await open(config, "session", pending.session);
  if (!session || session.userId !== config.userId) throw new HttpError(401, "登录链接已失效，请重新登录。");
  await checkRepo(config, session.token);
  return { session: pending.session, account: pending.account };
}

const paths = date => ({
  goals: "settings.json", foods: "foods.json", records: "records/" + date + ".json"
});
const empty = { goals: null, foods: [], records: [] };

async function readFile(config, token, path, fallback) {
  const response = await github(config.repo + "/contents/" + path, token);
  if (response.status === 404) return { value: fallback, sha: null };
  if (!response.ok) throw githubError(response.status);
  const file = await response.json();
  try {
    if (file.type !== "file" || file.encoding !== "base64" || typeof file.sha !== "string") throw new Error();
    return { value: JSON.parse(decoder.decode(fromBase64(file.content))), sha: file.sha };
  } catch {
    throw new HttpError(502, "GitHub 上的数据文件无法读取。");
  }
}

async function dashboard(config, token, date) {
  const entries = await Promise.all(Object.entries(paths(date)).map(async ([key, path]) => [
    key, await readFile(config, token, path, empty[key])
  ]));
  if (entries.some(([, file]) => file.sha === null)) await checkRepo(config, token);
  return Object.fromEntries(entries);
}

function values(files) {
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file.value]));
}

function readOperation(body) {
  if (body.type === "goals" && validAmounts(body.amounts, 1000000)) {
    return { key: "goals", apply: () => body.amounts };
  }
  if (body.type !== "food" && body.type !== "record") throw new HttpError(400, "要保存的数据格式有误。");
  const isFood = body.type === "food";
  const key = isFood ? "foods" : "records";
  if (typeof body.remove === "string" && idPattern.test(body.remove)) {
    return { key, apply: list => list.filter(item => item.id !== body.remove) };
  }
  const item = body.value;
  const amountsKey = isFood ? "perHundred" : "amounts";
  if (!item || typeof item.id !== "string" || !idPattern.test(item.id) ||
      typeof item.name !== "string" || item.name.trim().length > 60 ||
      (isFood && !item.name.trim()) || !validAmounts(item[amountsKey], isFood ? 10000 : 1000000) ||
      !hasAmount(item[amountsKey])) {
    throw new HttpError(400, "请检查营养素克数和食物名称。");
  }
  const value = { id: item.id, name: item.name.trim(), [amountsKey]: item[amountsKey] };
  return {
    key,
    apply(list) {
      if (list.some(entry => entry.id === value.id)) return list.map(entry => entry.id === value.id ? value : entry);
      if (list.length >= (isFood ? 150 : 300)) throw new HttpError(400, "这份列表已达上限，请删除不需要的条目。");
      return [...list, value];
    }
  };
}

async function writeChange(config, token, path, first, operation) {
  let file = first;
  for (let attempt = 0; attempt < 4; attempt++) {
    const value = operation.apply(file.value);
    if (JSON.stringify(value) === JSON.stringify(file.value)) return value;
    const response = await github(config.repo + "/contents/" + path, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update nutrition data",
        content: base64(encoder.encode(JSON.stringify(value, null, 2) + "\n")),
        ...(file.sha ? { sha: file.sha } : {})
      })
    });
    if (response.ok) return value;
    if (response.status !== 409 && (response.status !== 422 || file.sha)) throw githubError(response.status);
    file = await readFile(config, token, path, empty[operation.key]);
  }
  throw new HttpError(409, "另一台设备正在更新，请稍后重试。");
}

async function readBody(request) {
  try {
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error();
    return JSON.parse(await request.text()) || {};
  } catch {
    throw new HttpError(400, "请求格式有误。");
  }
}

function json(data, status, origin) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return Response.json(data, { status, headers });
}

export default {
  async fetch(request, env) {
    let origin;
    try {
      const config = settings(env);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/auth/start") return await startLogin(config, url);
      if (request.method === "GET" && url.pathname === "/auth/callback") return await finishGithubLogin(config, url);
      if (request.headers.get("Origin") !== config.site.origin) throw new HttpError(403, "请从网站访问。");
      origin = config.site.origin;
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600",
          Vary: "Origin"
        } });
      }
      if (request.method === "POST" && url.pathname === "/auth/claim") {
        return json(await claim(config, await readBody(request)), 200, origin);
      }
      const reading = request.method === "GET" && url.pathname === "/api/day";
      const writing = request.method === "POST" && url.pathname === "/api/change";
      if (!reading && !writing) throw new HttpError(404, "这个地址不存在。");
      const authorization = request.headers.get("Authorization");
      const session = authorization?.startsWith("Bearer ") && await open(config, "session", authorization.slice(7));
      if (!session || session.userId !== config.userId) throw new HttpError(401, "请先用 GitHub 登录。");
      const body = writing ? await readBody(request) : null;
      const date = reading ? url.searchParams.get("date") : body.date;
      if (!validDate(date)) throw new HttpError(400, "日期无效。");
      const operation = writing ? readOperation(body) : null;
      const files = await dashboard(config, session.token, date);
      const data = values(files);
      if (operation) {
        const key = operation.key;
        data[key] = await writeChange(config, session.token, paths(date)[key], files[key], operation);
      }
      return json(data, 200, origin);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const message = error instanceof HttpError ? error.message : "同步服务遇到问题，请稍后重试。";
      return json({ error: message }, status, origin);
    }
  }
};
