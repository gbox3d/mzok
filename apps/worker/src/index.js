// MZOK — 기기 ID → 주소. 같은 ID 로 넣으면 덮어쓰고, 없으면 새로 만든다. 목록을 본다.
//
// 토큰은 하나다(Worker secret MZOK_TOKEN) — 읽기·쓰기 모두. health 와 help(/api/help)만 토큰 없이 답한다.
// 언제 무엇을 보낼지는 보내는 쪽(바로터널 등)이 정한다. 여기는 저장만 한다.
// 관리 페이지는 GitHub Pages(docs/)에 있고, 브라우저가 부를 수 있게 그 출처 하나에만 CORS 를 연다.

import { helpText } from "./help.js";

const VERSION = "0.3.0";
// "." 과 ".." 은 뺀다 — URL 파서(workerd·curl)가 점 세그먼트를 접어서 그 경로에는 닿을 수 없다.
const ID_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,64}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PAGE_ORIGIN = "https://gbox3d.github.io";
// 브라우저는 토큰 헤더를 다른 출처로 보내기 전에 OPTIONS 로 먼저 묻는다(preflight).
// 허락을 2시간(크롬 상한) 기억하게 해서, 그동안은 호출마다 1건만 나가게 한다.
const CORS = {
  "access-control-allow-origin": PAGE_ORIGIN,
  "access-control-allow-methods": "GET, PUT, DELETE",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "7200",
};

export default {
  async fetch(request, env) {
    let res;
    try {
      res = await route(request, env);
    } catch (err) {
      // 원인은 응답이 아니라 로그로(`wrangler tail`) — 에러 문구를 밖에 보이지 않는다.
      console.error(err);
      res = fail(500, "internal", "서버 오류");
    }
    // 에러도 CORS 헤더를 달아야 페이지가 401 같은 답을 읽는다.
    if (request.headers.get("origin") === PAGE_ORIGIN) {
      for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    }
    res.headers.append("vary", "Origin");
    return res;
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  // preflight 는 토큰 없이 온다 — 허락 여부(CORS 헤더)는 fetch() 가 붙인다. 다른 출처에는 헤더가 안 붙어 브라우저가 막는다.
  if (method === "OPTIONS") return new Response(null, { status: 204 });

  if (path === "/v1/health") {
    return method === "GET" ? ok({ name: "mzok", version: VERSION }) : notAllowed();
  }
  if (path === "/api/help") {
    if (method !== "GET") return notAllowed();
    // help 는 http 로도 열리지만 나머지는 https 만 받는다 — 로컬이 아니면 https 주소를 적어 준다.
    // (http 로 읽은 에이전트가 예시를 그대로 복사해 토큰을 평문으로 보내지 않게.)
    const base = LOCAL_HOSTS.has(url.hostname) ? url.origin : `https://${url.host}`;
    return new Response(helpText(base, VERSION), {
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // workers.dev 는 http:// 도 리다이렉트 없이 받는다. 토큰이 평문으로 오지 않게 거절한다.
  if (isPlainHttp(request, url)) {
    return fail(403, "https_required", "https:// 로 부른다 — http 로는 토큰이 평문으로 지나간다");
  }
  if (!(await authorized(request, env))) {
    return fail(401, "unauthorized", "Authorization: Bearer <토큰> 이 없거나 맞지 않다 — 사용법은 GET /api/help");
  }

  if (path === "/v1/devices") return method === "GET" ? listDevices(env) : notAllowed();

  const m = path.match(/^\/v1\/devices\/([^/]+)$/);
  if (!m) return fail(404, "not_found", `${method} ${path} 는 없다 — 사용법은 GET /api/help`);
  // 경로 조각은 디코딩하지 않는다 — ID 는 인코딩이 필요 없는 글자뿐이고,
  // 디코딩은 잘못된 %이스케이프를 500 으로 만들기만 한다.
  const id = m[1];
  if (!ID_RE.test(id)) return fail(400, "bad_id", "기기 ID 는 영문·숫자·. _ - 1~64자");
  if (method === "GET") return getDevice(env, id);
  if (method === "PUT") return putDevice(request, env, id);
  if (method === "DELETE") return deleteDevice(env, id);
  return notAllowed();
}

// 해시끼리 비교한다 — 원문을 바로 비교하면 앞에서부터 틀린 자리에서 멈추는 시간 차로 토큰이 샐 여지가 있다.
async function authorized(request, env) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!m || !env.MZOK_TOKEN) return false;
  return (await sha256hex(m[1])) === (await sha256hex(env.MZOK_TOKEN));
}

function isPlainHttp(request, url) {
  if (LOCAL_HOSTS.has(url.hostname)) return false;
  if (url.protocol === "http:") return true;
  return /"scheme"\s*:\s*"http"/.test(request.headers.get("cf-visitor") ?? "");
}

async function listDevices(env) {
  const { results } = await env.DB.prepare("SELECT * FROM devices ORDER BY id").all();
  return ok({ devices: results.map(present) });
}

async function getDevice(env, id) {
  const row = await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first();
  return row ? ok({ device: present(row) }) : fail(404, "no_device", `${id} 는 없다`);
}

async function putDevice(request, env, id) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    // 아래 url 검사에서 bad_url 로 떨어진다
  }
  const target = tunnelUrl(body?.url);
  if (!target) {
    return fail(400, "bad_url", '본문은 {"url": "https://..."} — 공백·계정·?쿼리·#조각 없는 http(s) 절대 주소');
  }
  const row = await env.DB.prepare(
    `INSERT INTO devices (id, url, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at
     RETURNING *`,
  ).bind(id, target, Date.now()).first();
  return ok({ device: present(row) });
}

async function deleteDevice(env, id) {
  const { meta } = await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(id).run();
  return ok({ deleted: meta.changes > 0 });
}

// 검사한 값과 저장하는 값이 같아야 한다. URL 파서는 탭·줄바꿈을 말없이 지우고 `https:host` 같은
// 모양도 고쳐서 받으므로, 원문이 아니라 **파싱된 정규형**을 저장한다. 공백·제어문자는 아예 받지 않는다.
function tunnelUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  const s = raw.trim();
  if (/[\s\x00-\x1f\x7f]/.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  // 기준 주소에는 계정·쿼리·조각이 붙을 일이 없다 — 붙어 있으면 `${url}/api/...` 가 깨진다.
  if (u.username || u.password || u.search || u.hash) return null;
  // 뒤따르는 / 를 떼 둔다 — 쓰는 쪽이 `${url}/api/...` 로 붙일 때 // 가 생기지 않게.
  return u.origin + u.pathname.replace(/\/+$/, "");
}

function present(row) {
  return { id: row.id, url: row.url, updatedAt: new Date(row.updated_at).toISOString() };
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const ok = (body) => json(200, { ok: true, ...body });
const fail = (status, error, message) => json(status, { ok: false, error, message });
const notAllowed = () => fail(405, "method_not_allowed", "이 경로에서 받지 않는 메서드다");
