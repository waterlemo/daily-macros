import { createServer } from "node:http";
import api from "./api.mjs";

const internalOrigin = "http://localhost";

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 65536) throw new RangeError("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function errorResponse(status, error) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function respond(request, env) {
  const url = new URL(request.url, internalOrigin);
  if (url.origin !== internalOrigin) return errorResponse(400, "请求地址无效。");
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!["GET", "POST", "OPTIONS"].includes(request.method)) {
    return errorResponse(405, "请求方法不受支持。");
  }

  const headers = new Headers();
  for (const name of ["origin", "authorization", "content-type"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const body = request.method === "POST" ? await readBody(request) : undefined;
  return api.fetch(new Request(url, { method: request.method, headers, body }), env);
}

const server = createServer(async (request, response) => {
  let reply;
  try {
    reply = await respond(request, process.env);
  } catch (error) {
    request.resume();
    reply = error instanceof RangeError
      ? errorResponse(413, "请求内容太大。")
      : errorResponse(502, "同步服务遇到问题，请稍后重试。");
  }
  response.writeHead(reply.status, Object.fromEntries(reply.headers));
  response.end(Buffer.from(await reply.arrayBuffer()));
});

server.listen(9000, "0.0.0.0");
