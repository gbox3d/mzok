// GET /api/help — AI 에이전트용 사용 설명. 팀의 다른 서버(/memo/api/help, /calory/api/help)와 같은 관례:
// 토큰 없이 열리고, text/markdown, 영어(읽는 쪽이 기계다), 서버 주소·버전은 요청마다 계산해 넣는다.
export function helpText(origin, version) {
  return `# MZOK — device id → URL registry

A tiny key-value service: each **device id** maps to **one URL** — typically the current Cloudflare
quick-tunnel address of that device, which changes every time its tunnel restarts. Writers PUT the
latest URL under their id; readers GET it. MZOK only stores. It does not open, watch or test tunnels;
whoever sends (for example baro_tunnel) decides when to send.

This document is English-only on purpose: its reader is a machine.

## This server, right now

- Base URL: \`${origin}\`
- Version: \`${version}\`

## Auth

- **One shared token** for reading and writing. Send \`Authorization: Bearer <token>\` on every route
  except \`GET /api/help\` and \`GET /v1/health\`. No route issues tokens: if you have none, stop and ask
  your user for it — do not guess or search for one.
- Never commit the token, never put it in a URL, a log line or a web page.
- **HTTPS only.** A plain \`http://\` request (other than help/health) is refused with 403
  \`https_required\` before the token is checked — but it has already crossed the network in clear,
  so treat a token sent that way as leaked and tell your user.

## Routes

| Method and path | Body | Answer |
|---|---|---|
| \`PUT /v1/devices/{id}\` | \`{"url": "https://..."}\` | **Upsert**: overwrites the id if it exists, creates it otherwise → \`{"ok":true,"device":{...}}\` |
| \`GET /v1/devices\` | — | \`{"ok":true,"devices":[...]}\`, sorted by id in byte order (upper case before lower case) |
| \`GET /v1/devices/{id}\` | — | \`{"ok":true,"device":{...}}\`, or 404 \`no_device\` |
| \`DELETE /v1/devices/{id}\` | — | \`{"ok":true,"deleted":true}\` — idempotent: \`false\` if it was not there |
| \`GET /v1/health\` | — | \`{"ok":true,"name":"mzok","version":"${version}"}\` — no token |
| \`GET /api/help\` | — | this document — no token |

Every success is HTTP 200 with \`"ok":true\`; a PUT does not tell whether it created or overwrote.
A device is \`{"id": "pi-01", "url": "https://abc.trycloudflare.com", "updatedAt": "<ISO-8601>"}\`.
\`updatedAt\` is when that id was last PUT (server clock). It tells you when the URL was last *sent*,
not whether it still answers.

## Rules

- **id**: \`[A-Za-z0-9._-]\`, 1–64 characters, not \`.\` or \`..\`. Case-sensitive. Never percent-encode it.
- **url**: absolute \`http://\` or \`https://\`, at most 2048 characters, with no whitespace or control
  characters inside it (surrounding whitespace is trimmed), no \`user:pass@\`, no \`?query\` and no \`#fragment\`.
- The url is stored in **canonical form** — what a WHATWG URL parser makes of it, minus the trailing \`/\`:
  lowercase scheme and host, default port dropped, \`.\`/\`..\` segments resolved.
  \`https://ABC.trycloudflare.com:443/\` is stored as \`https://abc.trycloudflare.com\`. Use the \`url\` from the
  response, not the one you sent, and build requests as \`\${url}/api/...\`.
- **One namespace.** Any token holder can overwrite or delete any id. Choose ids that will not collide
  with other writers (for example \`<host>-<port>\`), and never write an id you do not own.
- **A stored URL can be dead** — a tunnel that died without a DELETE leaves its last URL behind.
  Probe it before you rely on it.

## Errors

Every error is JSON: \`{"ok":false,"error":"<code>","message":"<human text, in Korean>"}\`.
Branch on \`error\`, never on \`message\`. Checks run in this order and the first failure answers:
plain http (403) → token (401) → route (404) → id (400) → method (405) → body (400). So without a valid token
every route except help and health answers 401, even one that does not exist.

| Status | error | Meaning |
|---|---|---|
| 400 | \`bad_id\` | the id breaks the id rule |
| 400 | \`bad_url\` | the body is not JSON, has no \`url\`, or the url breaks the url rule |
| 401 | \`unauthorized\` | missing or wrong token |
| 403 | \`https_required\` | plain http — resend over https, and tell your user the token leaked |
| 404 | \`no_device\` | no such id |
| 404 | \`not_found\` | no such route |
| 405 | \`method_not_allowed\` | the route exists, the method does not |
| 500 | \`internal\` | server fault; details are only in the server log |

On a 500 or any answer that is not JSON, retry at most 3 times with backoff (1 s, 5 s, 30 s), then give up
and report. On Cloudflare error 1027 (daily limit), stop until 00:00 UTC.

## Examples

\`\`\`sh
B=${origin}
T=<token>
curl -sS -X PUT "$B/v1/devices/pi-01" -H "Authorization: Bearer $T" -d '{"url":"https://abc.trycloudflare.com"}'
curl -sS "$B/v1/devices"               -H "Authorization: Bearer $T"
curl -sS "$B/v1/devices/pi-01"         -H "Authorization: Bearer $T"
curl -sS -X DELETE "$B/v1/devices/pi-01" -H "Authorization: Bearer $T"
\`\`\`

A Content-Type header is optional; the PUT body must be JSON.

## Limits

- Cloudflare free plan: 100,000 requests per day for the whole account, reset at 00:00 UTC. Past that,
  Cloudflare answers error 1027 as an HTML page, not JSON. Do not poll in a tight loop.
- CORS is open to one origin only: the admin page at \`https://gbox3d.github.io\`. A browser page on any
  other origin cannot call it; scripts, servers and devices are not affected by CORS.
`;
}
