# MZOK

## 개요

터널링을 위한 중계서비스 이다.
항상바뀔수 있는 터널링 주소를 일정하게 확인해볼수있도록 중계를 해줄수있다.

## 기능
- 안정적인 고정주소가 필요하다.
- 고유서버 번호와 실제 외부 접속 가능한 터널링주소를 매칭해주면된다. 
- 아무나 접근할수잇게 토큰을 발행하여 관리 한다.
- api 형태로 서비스 한다.
- 간단한 db를 사용해도 좋을듯한데 최소한의 저장소가 필요할듯

## 어디서 도는가

- 주소: `__localfiles/.env` 의 `MZOK_URL` — 공개 저장소라 여기 적지 않는다. Cloudflare Workers(무료) + D1. 2026-09-23 배포.
- 카드 없이 무료, 잠들지 않는다, 하루 요청 10만(계정 단위, 09:00 KST 에 초기화). 개인용이라 한도는 의미 없다.
- 결정 근거와 탈락한 후보는 로컬의 `_forAI/memo.md`(실제 장비 주소가 있어 저장소에는 올리지 않는다).
- workers.dev 이름은 Cloudflare 가 바꿀 수 있다(약관, 1주 전 통지 노력). 보내는 쪽은 주소를 설정 한 곳에 둔다.

## API

**AI 에이전트용 설명서: `GET /api/help`** (토큰 없이, markdown). 사람용 요약은 아래.

토큰은 하나 — `Authorization: Bearer <토큰>` 으로 읽기·쓰기 모두. https 로만 받는다(health·help 제외).

| 요청 | 하는 일 |
|---|---|
| `PUT /v1/devices/<id>` `{"url": "https://..."}` | **있으면 덮어쓰고, 없으면 새로 만든다** |
| `GET /v1/devices` | 목록 (id 바이트 순 — 대문자가 소문자 앞) |
| `GET /v1/devices/<id>` | 한 대 (없으면 404) |
| `DELETE /v1/devices/<id>` | 지우기 (없어도 200) |
| `GET /v1/health` · `GET /api/help` | 살아 있는지 · 설명서 — 토큰 없이 |

기기는 `{id, url, updatedAt}` — `updatedAt` 은 마지막으로 PUT 한 시각이다.
id 는 영문·숫자·`. _ -` 1~64자(`.`·`..` 단독은 안 됨), 대소문자 구분. url 은 http(s) 절대 주소(안쪽 공백·계정·`?쿼리`·`#조각`
없이, 앞뒤 공백은 잘라 냄)이고, 서버는 URL 정규형으로 저장한다(스킴·호스트 소문자, 기본 포트·`.`/`..` 조각·끝의 `/` 제거).
저장된 값은 응답의 `url` 로 확인한다. 성공은 모두 200 이다.

```bash
B=<MZOK_URL>; T=<토큰>
curl -X PUT "$B/v1/devices/pi-01" -H "Authorization: Bearer $T" -d '{"url":"https://abc.trycloudflare.com"}'
curl "$B/v1/devices" -H "Authorization: Bearer $T"
```

MZOK 는 **저장만** 한다. 언제 보낼지는 보내는 쪽(바로터널 등)이 정한다.
손으로 시험할 때는 `__localfiles/test.http`(VS Code REST Client, 토큰은 같은 폴더 `.env`).

## 관리 페이지

**https://gbox3d.github.io/mzok/** — GitHub Pages(`docs/index.html`, 정적 파일 하나). 서버 주소와 토큰을 넣으면
기기 목록을 보여 주고, 줄을 누르면 상세(주소 전체·갱신 시각), 오른쪽 **바로가기**로 그 터널 주소를 새 탭에 연다.

- 다른 출처에서 REST 를 부르는 실사용 시험을 겸한다 — Worker 는 `https://gbox3d.github.io` 한 출처에만 CORS 를 연다.
- 브라우저는 토큰 헤더를 다른 출처로 보내기 전에 `OPTIONS`(preflight)를 먼저 보낸다. 서버가 2시간 기억하게 답하므로
  그 안의 호출은 1건씩이다. 스크립트·서버·기기에서 부르는 호출에는 preflight 가 없다(항상 1건).
- 페이지와 저장소에는 서버 주소도 토큰도 적지 않는다. 주소는 이 브라우저(`localStorage`)에, 토큰은 그 탭에만
  (`sessionStorage`, 탭을 닫으면 지워짐) 둔다. `gbox3d.github.io` 아래의 다른 Pages 와 `localStorage` 를 같이 쓰기 때문이다.
- 배포: `main` 브랜치의 `docs/` 가 그대로 Pages 로 나간다(push 하면 끝).

## 구조

```
mzok/
├── apps/worker/
│   ├── src/index.js          API 전부
│   ├── src/help.js           GET /api/help 본문
│   ├── migrations/           D1 스키마 (0001 → 0002 에서 단순화)
│   ├── test/api.test.mjs     로컬 workerd + 로컬 D1 (node:test)
│   └── wrangler.jsonc
├── docs/index.html           관리 페이지 (GitHub Pages)
├── __localfiles/             (git 밖) .env · test.http
└── _forAI/                   (git 밖) AI 작업 메모
```

## 개발

```bash
pnpm install
pnpm test                         # 로컬 workerd + 로컬 D1, 네트워크·계정 불필요

cd apps/worker
cp .dev.vars.example .dev.vars    # 로컬 토큰 MZOK_TOKEN
npx wrangler d1 migrations apply mzok --local
npx wrangler dev                  # http://localhost:8787
```

## 배포

`apps/worker` 에서. 스키마를 바꿨으면 `npx wrangler d1 migrations apply mzok --remote` 먼저, 그다음:

```bash
npx wrangler deploy
```

**토큰 바꾸기**: 새 값을 `__localfiles/.env` 에 적고 `npx wrangler secret put MZOK_TOKEN` 으로 같은 값을 넣은 뒤,
보내는 쪽 설정도 바꾼다. 토큰이 하나라 새면 전부 새로 바꾼다.

### 처음부터 새 계정에 올릴 때

Cloudflare 가입(무료, 카드 불필요) 후 **이메일 인증을 먼저** 끝낸다 — 안 하면 deploy 가
`You need to verify your email address to use Workers [code: 10034]` 로 막힌다.

```bash
npx wrangler login
npx wrangler d1 create mzok --binding DB --update-config   # wrangler.jsonc 의 DB 항목에 database_id 를 채운다
npx wrangler d1 migrations apply mzok --remote
npx wrangler deploy
printf '%s' "<토큰>" | npx wrangler secret put MZOK_TOKEN    # 넣기 전까지는 모든 요청이 401
```

- `--binding DB` 를 빼면 wrangler 가 두 번째 바인딩을 만들어 붙인다.
- **첫 배포를 비대화(`CI=1`·파이프) 모드로 돌리지 않는다** — workers.dev 서브도메인을 묻지 않고
  `<worker 이름>-worker` 로 등록해 버린다(2026-09-23 실측). 이미 생긴 이름은 API 로 못 바꾸고
  (`10036`) 대시보드 **Workers & Pages → Subdomain → Change** 로만 바뀐다. 이 계정도 그렇게 바꿨다.
- database_id 를 바꾸면 로컬 D1 도 갈리므로 `d1 migrations apply mzok --local` 을 다시 한다.

## 한계

- **토큰이 하나**다 — 토큰을 가진 쪽은 누구든 어느 id 든 덮어쓰고 지울 수 있다.
- **터널은 인증이 아니다** — MZOK 가 주소를 토큰 뒤에 둬도, 주소를 아는 사람은 그 서비스를 그대로 쓴다.
  원격 제어 대상 서비스는 자기 인증을 가져야 한다.
- 저장된 주소가 살아 있다는 보장은 없다 — 터널이 DELETE 없이 죽으면 마지막 주소가 남는다. 쓰기 전에 불러 본다.
- 퀵터널은 Cloudflare 문서상 "testing and development only", SLA 없음.
