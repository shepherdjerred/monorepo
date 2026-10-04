CREATE TABLE mail_messages (
    message_id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    selected TEXT,
    delivered INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mail_options (
    message_id TEXT NOT NULL REFERENCES mail_messages(message_id),
    option_id TEXT NOT NULL,
    PRIMARY KEY (message_id, option_id)
);
CREATE TABLE mail_items (
    message_id TEXT NOT NULL REFERENCES mail_messages(message_id),
    option_id TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    item BLOB NOT NULL,
    PRIMARY KEY (message_id, option_id, item_index),
    FOREIGN KEY (message_id, option_id) REFERENCES mail_options(message_id, option_id)
);
CREATE TABLE mail_batches (
    token_id TEXT NOT NULL PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES mail_messages(message_id),
    owner_id TEXT NOT NULL UNIQUE,
    start_index INTEGER NOT NULL,
    end_index INTEGER NOT NULL
);
