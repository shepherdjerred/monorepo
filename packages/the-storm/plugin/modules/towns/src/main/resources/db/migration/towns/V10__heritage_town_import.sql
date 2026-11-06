-- Durable receipts prevent a disbanded historical town from being resurrected.
CREATE TABLE towns_heritage_import (
    town_id TEXT PRIMARY KEY NOT NULL
);
