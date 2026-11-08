-- Keep receipts after a shop is removed: an owner may intentionally close it.
CREATE TABLE shops_historical_import (
    source_id TEXT PRIMARY KEY NOT NULL CHECK (length(source_id) > 0),
    world TEXT NOT NULL,
    sign_x INTEGER NOT NULL,
    sign_y INTEGER NOT NULL,
    sign_z INTEGER NOT NULL,
    shop_id INTEGER NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('in_doubt', 'complete')),
    UNIQUE (world, sign_x, sign_y, sign_z)
);
