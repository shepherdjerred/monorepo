CREATE TABLE mail_letters (
  id TEXT PRIMARY KEY NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  read_at BIGINT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
);
CREATE INDEX mail_letters_inbox ON mail_letters(recipient, deleted, sent_at);
CREATE INDEX mail_letters_sender ON mail_letters(sender, sent_at);
