-- One-time source receipts; restored destinations live in the ordinary homes table.
CREATE TABLE essentials_home_import (
    player TEXT NOT NULL,
    source TEXT NOT NULL,
    world TEXT NOT NULL,
    x DOUBLE NOT NULL,
    y DOUBLE NOT NULL,
    z DOUBLE NOT NULL,
    PRIMARY KEY (player, source)
);
