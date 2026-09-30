-- Outbox rows are independent of quests_player because full state saves replace that row.
CREATE TABLE quests_pending_world (
    sequence    INTEGER PRIMARY KEY AUTOINCREMENT,
    id          TEXT NOT NULL UNIQUE,
    player_id   TEXT NOT NULL,
    quest_id    TEXT NOT NULL,
    action_kind TEXT NOT NULL,
    payload     TEXT NOT NULL
);

CREATE INDEX quests_pending_world_player ON quests_pending_world (player_id, sequence);
