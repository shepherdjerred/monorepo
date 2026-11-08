CREATE TABLE skytravel_flights (
  player TEXT PRIMARY KEY NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('ASCENT', 'GLIDE', 'DESCENT', 'ENDED')),
  assisted_until BIGINT NOT NULL,
  protected_until BIGINT NOT NULL,
  cooldown_until BIGINT NOT NULL
);
