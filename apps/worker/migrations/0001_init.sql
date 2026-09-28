-- 기기 하나 = 행 하나. url 은 지금 살아 있는 터널 주소다.
--   updated_at : url 이 마지막으로 **바뀐** 시각 (ms)
--   last_seen  : 기기가 마지막으로 등록(=heartbeat)한 시각 (ms)
CREATE TABLE devices (
  id         TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  note       TEXT,
  updated_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

-- 발급한 토큰. 원문은 두지 않는다 — 발급 응답에 한 번만 나가고 여기엔 SHA-256 만 남는다.
-- admin 토큰은 여기 없다 (Worker secret MZOK_ADMIN_TOKEN).
CREATE TABLE tokens (
  id         TEXT PRIMARY KEY,
  hash       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('device', 'reader')),
  device_id  TEXT,
  label      TEXT,
  created_at INTEGER NOT NULL
);
