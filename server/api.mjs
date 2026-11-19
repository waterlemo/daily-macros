import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hasAmount, validAmounts, validDate } from "../docs/domain.mjs";
import { createCosStore } from "./cos-store.mjs";

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const paths = date => ({
  goals: "settings", foods: "foods", records: "records/" + date
});
const empty = { goals: null, foods: [], records: [] };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function siteOrigin(env) {
  const site = URL.canParse(env.SITE_URL) && new URL(env.SITE_URL);
  if (!site || site.protocol !== "https:" || site.username || site.password) {
    throw new HttpError(503, "网站地址尚未配置。");
  }
  return site.origin;
}

function authSettings(env) {
  if (!/^[a-f0-9]{64}$/.test(env.PASSPHRASE_HASH || "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(env.SESSION_KEY || "")) {
    throw new HttpError(503, "登录服务尚未配置。");
  }
  return { passphraseHash: Buffer.from(env.PASSPHRASE_HASH, "hex"), sessionKey: Buffer.from(env.SESSION_KEY, "base64url") };
}

function signature(config, payload) {
  return createHmac("sha256", config.sessionKey).update(payload).digest();
}

function login(config, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length > 128 ||
      !timingSafeEqual(config.passphraseHash, createHash("sha256").update(passphrase).digest())) {
    throw new HttpError(401, "口令不正确。");
  }
  const payload = [Date.now() + sessionLifetime, randomBytes(16).toString("base64url")].join(".");
  return { session: payload + "." + signature(config, payload).toString("base64url") };
}

function signedIn(config, authorization) {
  const token = authorization?.match(/^Bearer (\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/);
  if (!token || Number(token[1]) <= Date.now()) return false;
  const expected = signature(config, token[1] + "." + token[2]);
  return timingSafeEqual(expected, Buffer.from(token[3], "base64url"));
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

async function readBody(request) {
  try {
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error();
    return (await request.json()) || {};
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
      const url = new URL(request.url);
      const allowed = siteOrigin(env);
      if (request.headers.get("Origin") !== allowed) throw new HttpError(403, "请从网站访问。");
      origin = allowed;
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600",
          Vary: "Origin"
        } });
      }
      const loggingIn = request.method === "POST" && url.pathname === "/auth/login";
      const reading = request.method === "GET" && url.pathname === "/api/day";
      const writing = request.method === "POST" && url.pathname === "/api/change";
      if (!loggingIn && !reading && !writing) throw new HttpError(404, "这个地址不存在。");
      const config = authSettings(env);
      if (loggingIn) return json(login(config, (await readBody(request)).passphrase), 200, origin);
      if (!signedIn(config, request.headers.get("Authorization"))) throw new HttpError(401, "请先用口令登录。");

      const body = writing ? await readBody(request) : null;
      const date = reading ? url.searchParams.get("date") : body.date;
      if (!validDate(date)) throw new HttpError(400, "日期无效。");
      const operation = writing ? readOperation(body) : null;
      const store = createCosStore(env);
      const entries = await Promise.all(Object.entries(paths(date)).map(async ([key, path]) => {
        if (operation?.key !== key) return [key, await store.read(path, empty[key])];
        const result = await store.change(path, empty[key], operation.apply);
        if (!result) throw new HttpError(409, "另一台设备正在更新，请稍后重试。");
        return [key, result.value];
      }));
      return json(Object.fromEntries(entries), 200, origin);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const message = error instanceof HttpError ? error.message : "同步服务遇到问题，请稍后重试。";
      if (status === 502) console.error("Daily Macros storage error:", error.code || error.name || "unknown");
      return json({ error: message }, status, origin);
    }
  }
};
