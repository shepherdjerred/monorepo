-- First eligible main-world pickup of each authored collection item.
CREATE TABLE quests_discovery (
    player_id   TEXT   NOT NULL REFERENCES quests_player (player_id) ON DELETE CASCADE,
    collection  TEXT   NOT NULL,
    first_at    BIGINT NOT NULL,
    PRIMARY KEY (player_id, collection)
);
