-- 0.2.0: 토큰은 Worker secret 하나(MZOK_TOKEN)로 줄였다 — 발급·폐기용 테이블이 필요 없다.
-- 기기는 id · url · updated_at(마지막으로 PUT 한 시각)만 둔다.
DROP TABLE tokens;
ALTER TABLE devices DROP COLUMN note;
ALTER TABLE devices DROP COLUMN last_seen;
