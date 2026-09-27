-- Chat state that outlives a session. Player ids are UUID strings; instants
-- are epoch milliseconds.

-- The channel a player talks in when they type without a command.
CREATE TABLE chat_focus (
  player TEXT PRIMARY KEY NOT NULL,
  channel TEXT NOT NULL
);

-- Channels a player chose not to receive.
CREATE TABLE chat_hidden_channel (
  player TEXT NOT NULL,
  channel TEXT NOT NULL,
  PRIMARY KEY (player, channel)
);

-- Players a player ignores, with the name they had when ignored (for /unignore).
CREATE TABLE chat_ignore (
  player TEXT NOT NULL,
  ignored TEXT NOT NULL,
  ignored_name TEXT NOT NULL,
  PRIMARY KEY (player, ignored)
);

-- Staff mutes. A mute ends at until_ms; expired rows are removed on load.
CREATE TABLE chat_mute (
  player TEXT PRIMARY KEY NOT NULL,
  until_ms BIGINT NOT NULL,
  reason TEXT NOT NULL,
  issuer TEXT NOT NULL
);
