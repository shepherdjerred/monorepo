-- Deposit banks and per-player sort switches.
CREATE TABLE qol_bank (
    id           TEXT    NOT NULL PRIMARY KEY,
    owner        TEXT    NOT NULL,
    world        TEXT    NOT NULL,
    sign_x       INTEGER NOT NULL,
    sign_y       INTEGER NOT NULL,
    sign_z       INTEGER NOT NULL,
    container_x  INTEGER NOT NULL,
    container_y  INTEGER NOT NULL,
    container_z  INTEGER NOT NULL
);

CREATE INDEX qol_bank_owner ON qol_bank (owner);
CREATE INDEX qol_bank_at ON qol_bank (world, sign_x, sign_y, sign_z);

CREATE TABLE qol_bank_grant (
    bank   TEXT NOT NULL REFERENCES qol_bank (id) ON DELETE CASCADE,
    player TEXT NOT NULL,
    role   TEXT NOT NULL,
    PRIMARY KEY (bank, player)
);

CREATE TABLE qol_shelf (
    id           TEXT    NOT NULL PRIMARY KEY,
    bank         TEXT    NOT NULL REFERENCES qol_bank (id) ON DELETE CASCADE,
    world        TEXT    NOT NULL,
    sign_x       INTEGER NOT NULL,
    sign_y       INTEGER NOT NULL,
    sign_z       INTEGER NOT NULL,
    container_x  INTEGER NOT NULL,
    container_y  INTEGER NOT NULL,
    container_z  INTEGER NOT NULL,
    restack      INTEGER NOT NULL
);

CREATE INDEX qol_shelf_bank ON qol_shelf (bank);
CREATE INDEX qol_shelf_at ON qol_shelf (world, sign_x, sign_y, sign_z);

CREATE TABLE qol_shelf_material (
    shelf    TEXT NOT NULL REFERENCES qol_shelf (id) ON DELETE CASCADE,
    material TEXT NOT NULL,
    PRIMARY KEY (shelf, material)
);

-- 0 and 1. A missing row means the player still has the config defaults.
CREATE TABLE qol_sort_player (
    player            TEXT    NOT NULL PRIMARY KEY,
    containers        INTEGER NOT NULL,
    inventory         INTEGER NOT NULL,
    middle_click      INTEGER NOT NULL,
    shift_click       INTEGER NOT NULL,
    double_click      INTEGER NOT NULL,
    shift_right_click INTEGER NOT NULL,
    dump              INTEGER NOT NULL,
    take              INTEGER NOT NULL,
    left_click_block  INTEGER NOT NULL
);
