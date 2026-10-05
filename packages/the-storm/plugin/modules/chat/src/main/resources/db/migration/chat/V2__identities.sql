CREATE TABLE chat_identity (
  player TEXT PRIMARY KEY NOT NULL,
  nickname TEXT,
  nickname_key TEXT UNIQUE,
  messages INTEGER NOT NULL DEFAULT 1 CHECK (messages IN (0, 1)),
  replies INTEGER NOT NULL DEFAULT 1 CHECK (replies IN (0, 1)),
  social_spy INTEGER NOT NULL DEFAULT 0 CHECK (social_spy IN (0, 1))
);
