-- A shop sign may name a town. The town's id is the treasury the trade pays.
-- SQLite cannot widen a CHECK, so the table is rebuilt with the same columns.
CREATE TABLE shops_shop_next (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    world         TEXT    NOT NULL,
    sign_x        INTEGER NOT NULL,
    sign_y        INTEGER NOT NULL,
    sign_z        INTEGER NOT NULL,
    container_x   INTEGER,
    container_y   INTEGER,
    container_z   INTEGER,
    owner_kind    TEXT    NOT NULL CHECK (owner_kind IN ('player', 'admin', 'town')),
    owner_id      TEXT,
    owner_name    TEXT    NOT NULL CHECK (length(owner_name) > 0),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    buy_price     BIGINT  CHECK (buy_price > 0),
    sell_price    BIGINT  CHECK (sell_price > 0),
    item_material TEXT,
    item_template TEXT,
    item_special  INTEGER CHECK (item_special IN (0, 1)),
    created_at    BIGINT  NOT NULL,
    UNIQUE (world, sign_x, sign_y, sign_z),
    CHECK ((owner_kind IN ('player', 'town')) = (owner_id IS NOT NULL)),
    CHECK (owner_kind = 'admin' OR container_x IS NOT NULL),
    CHECK ((container_x IS NULL) = (container_y IS NULL)
        AND (container_y IS NULL) = (container_z IS NULL)),
    CHECK (buy_price IS NOT NULL OR sell_price IS NOT NULL),
    CHECK (buy_price IS NULL OR sell_price IS NULL OR sell_price <= buy_price),
    CHECK ((item_material IS NULL) = (item_template IS NULL)
        AND (item_template IS NULL) = (item_special IS NULL))
);

INSERT INTO shops_shop_next SELECT * FROM shops_shop;

DROP TABLE shops_shop;

ALTER TABLE shops_shop_next RENAME TO shops_shop;

CREATE INDEX shops_shop_by_owner ON shops_shop (owner_id);
