-- Sign shops. The sign block carries the same id in its persistent data, so a
-- sign that no longer matches its row (replaced, pasted over) is not a shop.
-- BIGINT has SQLite's INTEGER affinity and makes jOOQ generate Long columns.
CREATE TABLE shops_shop (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    world         TEXT    NOT NULL,
    sign_x        INTEGER NOT NULL,
    sign_y        INTEGER NOT NULL,
    sign_z        INTEGER NOT NULL,
    -- The container the sign is attached to; admin shops need none.
    container_x   INTEGER,
    container_y   INTEGER,
    container_z   INTEGER,
    owner_kind    TEXT    NOT NULL CHECK (owner_kind IN ('player', 'admin')),
    owner_id      TEXT,
    owner_name    TEXT    NOT NULL CHECK (length(owner_name) > 0),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    buy_price     BIGINT  CHECK (buy_price > 0),
    sell_price    BIGINT  CHECK (sell_price > 0),
    -- The item, serialized with its components and Base64-encoded; NULL until
    -- the owner sets it. item_special marks a variant (enchanted, named, ...).
    item_material TEXT,
    item_template TEXT,
    item_special  INTEGER CHECK (item_special IN (0, 1)),
    created_at    BIGINT  NOT NULL,
    UNIQUE (world, sign_x, sign_y, sign_z),
    CHECK ((owner_kind = 'player') = (owner_id IS NOT NULL)),
    CHECK (owner_kind = 'admin' OR container_x IS NOT NULL),
    CHECK ((container_x IS NULL) = (container_y IS NULL)
        AND (container_y IS NULL) = (container_z IS NULL)),
    CHECK (buy_price IS NOT NULL OR sell_price IS NOT NULL),
    CHECK (buy_price IS NULL OR sell_price IS NULL OR sell_price <= buy_price),
    CHECK ((item_material IS NULL) = (item_template IS NULL)
        AND (item_template IS NULL) = (item_special IS NULL))
);

CREATE INDEX shops_shop_by_owner ON shops_shop (owner_id);

-- Every completed trade, at chest, admin and catalog shops: the owner's
-- summary on join, catalog daily limits and the audit trail. Rows outlive the
-- shop they came from.
CREATE TABLE shops_trade (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source         TEXT    NOT NULL CHECK (source IN ('chest', 'admin', 'catalog')),
    shop_id        INTEGER,
    catalog_id     TEXT,
    customer_id    TEXT    NOT NULL,
    customer_name  TEXT    NOT NULL,
    owner_id       TEXT,
    direction      TEXT    NOT NULL CHECK (direction IN ('buy', 'sell')),
    item_material  TEXT    NOT NULL,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    price          BIGINT  NOT NULL CHECK (price > 0),
    at             BIGINT  NOT NULL,
    -- 0 until the owner has been told, on the spot or in the summary on join.
    owner_notified INTEGER NOT NULL CHECK (owner_notified IN (0, 1)),
    CHECK ((source = 'catalog') = (catalog_id IS NOT NULL)),
    CHECK ((source = 'catalog') = (shop_id IS NULL)),
    CHECK ((source = 'chest') = (owner_id IS NOT NULL))
);

CREATE INDEX shops_trade_unnotified ON shops_trade (owner_id, owner_notified);
CREATE INDEX shops_trade_catalog_usage ON shops_trade (customer_id, catalog_id, at);

-- A refund that could not be made after a failed trade: staff settle these.
CREATE TABLE shops_refund_failure (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    payer_kind  TEXT    NOT NULL,
    payer_id    TEXT    NOT NULL,
    payee_kind  TEXT    NOT NULL,
    payee_id    TEXT    NOT NULL,
    amount      BIGINT  NOT NULL CHECK (amount > 0),
    reason      TEXT    NOT NULL,
    at          BIGINT  NOT NULL
);
