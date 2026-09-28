// Worker 를 로컬 workerd(miniflare) + 로컬 D1 에 올려 HTTP 계약을 잰다. 네트워크도 계정도 필요 없다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const TOKEN = "token-for-tests";
const BASE = "http://localhost";
let mf;

before(async () => {
  // scriptPath 하나만 주면 miniflare 는 import 한 다른 파일(help.js)을 싣지 않는다("No such module").
  // 배포는 wrangler 가 번들링하므로 상관없고, 여기서는 src/ 의 파일을 전부 모듈로 넘긴다 — index.js 가 먼저.
  const root = new URL("../", import.meta.url);
  const names = (await readdir(new URL("src/", root))).filter((n) => n.endsWith(".js"));
  names.sort((a, b) => (a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b)));
  mf = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: fileURLToPath(root),
    modules: names.map((n) => ({ type: "ESModule", path: fileURLToPath(new URL(`src/${n}`, root)) })),
    compatibilityDate: "2026-09-01",
    d1Databases: ["DB"],
    bindings: { MZOK_TOKEN: TOKEN },
  }));
  // 운영과 같은 마이그레이션 파일을 같은 순서로 적용한다 — 스키마를 테스트용으로 따로 두지 않는다.
  // (miniflare 의 db.exec 는 줄 단위라 주석을 지우고 ; 로 나눠 돌린다.)
  const db = await mf.getD1Database("DB");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const stmt of sql.replace(/--.*$/gm, "").split(";")) {
      if (stmt.trim()) await db.prepare(stmt).run();
    }
  }
});

after(() => mf?.dispose());

async function call(method, path, { token = TOKEN, body, base = BASE } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await mf.dispatchFetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const put = (id, url) => call("PUT", `/v1/devices/${id}`, { body: { url } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("health 는 토큰 없이 답한다", async () => {
  const r = await call("GET", "/v1/health", { token: null });
  assert.equal(r.status, 200);
  assert.equal(r.json.name, "mzok");
});

test("/api/help 는 토큰 없이 markdown 으로, 이 서버의 주소·버전과 모든 경로·에러 코드를 담는다", async () => {
  const res = await mf.dispatchFetch("https://mzok.example.workers.dev/api/help");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/markdown/);
  const md = await res.text();
  assert.ok(md.includes("`https://mzok.example.workers.dev`"), "주소는 요청마다 계산한다");
  const version = (await call("GET", "/v1/health", { token: null })).json.version;
  assert.ok(md.includes(`\`${version}\``));
  for (const route of ["PUT /v1/devices/{id}", "GET /v1/devices", "GET /v1/devices/{id}", "DELETE /v1/devices/{id}", "GET /v1/health", "GET /api/help"]) {
    assert.ok(md.includes(route), `도움말에 ${route}`);
  }
  for (const code of ["bad_id", "bad_url", "unauthorized", "https_required", "no_device", "not_found", "method_not_allowed", "internal"]) {
    assert.ok(md.includes(`\`${code}\``), `도움말에 에러 코드 ${code}`);
  }
  const overHttp = await mf.dispatchFetch("http://mzok.example.workers.dev/api/help");
  assert.equal(overHttp.status, 200, "토큰이 안 실리니 http 도 답한다");
  const httpMd = await overHttp.text();
  assert.ok(httpMd.includes("B=https://mzok.example.workers.dev"), "http 로 읽어도 예시 주소는 https — 복사한 토큰이 평문으로 가지 않게");
  assert.equal(httpMd.includes("http://mzok.example.workers.dev"), false);
  assert.equal((await mf.dispatchFetch("https://mzok.example.workers.dev/api/help", { method: "POST" })).status, 405);
});

test("CORS 는 관리 페이지 출처(GitHub Pages) 하나에만 — preflight 는 2시간 기억, 에러 답에도 붙는다", async () => {
  const PAGE = "https://gbox3d.github.io";
  const pre = await mf.dispatchFetch(`${BASE}/v1/devices`, {
    method: "OPTIONS",
    headers: { origin: PAGE, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  });
  assert.equal(pre.status, 204, "preflight 는 토큰 없이 통과");
  assert.equal(pre.headers.get("access-control-allow-origin"), PAGE);
  assert.match(pre.headers.get("access-control-allow-headers"), /authorization/);
  assert.equal(pre.headers.get("access-control-max-age"), "7200");

  const list = await mf.dispatchFetch(`${BASE}/v1/devices`, { headers: { origin: PAGE, authorization: `Bearer ${TOKEN}` } });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("access-control-allow-origin"), PAGE);
  const denied = await mf.dispatchFetch(`${BASE}/v1/devices`, { headers: { origin: PAGE } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("access-control-allow-origin"), PAGE, "페이지가 401 을 읽어 '토큰이 틀렸다'고 말할 수 있게");

  const other = await mf.dispatchFetch(`${BASE}/v1/devices`, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
  });
  assert.equal(other.headers.get("access-control-allow-origin"), null, "다른 출처의 브라우저 페이지는 막힌다");
  assert.equal((await call("GET", "/v1/devices")).json.ok, true, "Origin 없는 호출(스크립트·기기)은 그대로");
});

test("토큰이 없거나 틀리면 401", async () => {
  assert.equal((await call("GET", "/v1/devices", { token: null })).status, 401);
  assert.equal((await call("GET", "/v1/devices", { token: "wrong" })).status, 401);
  assert.equal((await call("PUT", "/v1/devices/pi", { token: "wrong", body: { url: "https://a.example" } })).status, 401);
});

test("같은 ID 로 넣으면 덮어쓰고, 없으면 새로 만든다", async () => {
  const made = await put("pi-01", "https://alpha.trycloudflare.com/");
  assert.equal(made.status, 200);
  assert.equal(made.json.device.url, "https://alpha.trycloudflare.com", "뒤따르는 / 는 뗀다");

  await pause(20);
  const over = await put("pi-01", "https://beta.trycloudflare.com");
  assert.equal(over.json.device.url, "https://beta.trycloudflare.com");
  assert.ok(over.json.device.updatedAt > made.json.device.updatedAt, "updatedAt = 마지막 PUT 시각");

  const one = await call("GET", "/v1/devices/pi-01");
  assert.equal(one.json.device.url, "https://beta.trycloudflare.com");
  assert.deepEqual(Object.keys(one.json.device).sort(), ["id", "updatedAt", "url"]);
});

test("목록은 모든 기기를 ID 순으로", async () => {
  await put("zz-last", "https://z.trycloudflare.com");
  await put("aa-first", "https://a.trycloudflare.com");
  const ids = (await call("GET", "/v1/devices")).json.devices.map((d) => d.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.ok(ids.includes("aa-first") && ids.includes("zz-last"));
});

test("삭제는 멱등이고, 지운 기기는 404", async () => {
  await put("pi-del", "https://d.trycloudflare.com");
  const del = await call("DELETE", "/v1/devices/pi-del");
  assert.equal(del.json.deleted, true);
  assert.equal((await call("GET", "/v1/devices/pi-del")).status, 404);
  assert.equal((await call("DELETE", "/v1/devices/pi-del")).json.deleted, false);
});

test("주소는 검사한 정규형으로 저장하고, 이상한 값은 400", async () => {
  assert.equal((await put("pi-n", "https:nosl.example")).json.device.url, "https://nosl.example");
  assert.equal((await put("pi-n", "HTTPS://Up.Example:443/Base/")).json.device.url, "https://up.example/Base");
  assert.equal((await put("pi-n", 'https://a.example/x"y')).json.device.url, "https://a.example/x%22y");

  for (const bad of [
    "ftp://x.example",
    "not a url",
    "https://user:pw@x.example",
    "https://good.example/\nhttps://evil.example/",
    "\u0001https://a.example",
    "https://a.example/?q=1",
    "https://a.example/#frag",
    undefined,
  ]) {
    assert.equal((await put("pi-n", bad)).json.error, "bad_url", JSON.stringify(bad));
  }
  assert.equal((await call("PUT", "/v1/devices/pi-n", { body: "{not json" })).json.error, "bad_url");
  assert.equal((await call("PUT", "/v1/devices/pi-n", { body: "[1,2]" })).json.error, "bad_url");
});

test("잘못된 ID 와 %이스케이프는 500 이 아니라 400", async () => {
  assert.equal((await call("GET", "/v1/devices/bad!id")).status, 400);
  assert.equal((await call("GET", "/v1/devices/%E0%A4")).status, 400);
  assert.equal((await call("GET", "/v1/devices/%")).status, 400);
  assert.equal((await put("a..b", "https://ok.example")).status, 200, "점이 섞인 보통 ID 는 된다");
});

test("로컬이 아닌 http:// 는 토큰을 보기 전에 거절한다", async () => {
  const r = await call("GET", "/v1/devices", { base: "http://mzok.example.workers.dev" });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "https_required");
  assert.equal((await call("GET", "/v1/devices", { base: "https://mzok.example.workers.dev" })).status, 200);
  assert.equal((await call("GET", "/v1/health", { base: "http://mzok.example.workers.dev" })).status, 200);
});

test("없는 경로 404, 안 받는 메서드 405", async () => {
  assert.equal((await call("GET", "/v1/nope")).status, 404);
  assert.equal((await call("GET", "/v1/tokens")).status, 404, "토큰 API 는 없어졌다");
  assert.equal((await call("POST", "/v1/devices/pi-x", { body: {} })).status, 405);
  assert.equal((await call("POST", "/v1/devices", { body: {} })).status, 405);
  assert.equal((await call("POST", "/v1/health")).status, 405);
});
