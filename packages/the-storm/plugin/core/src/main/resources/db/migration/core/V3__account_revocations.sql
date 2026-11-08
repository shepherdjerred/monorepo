CREATE TABLE core_account_epoch (
    player TEXT PRIMARY KEY NOT NULL,
    generation BIGINT NOT NULL CHECK (generation > 0)
);
