-- Each heritage site whose proven mayor holds an active town, recorded once. A site listed here is
-- never founded again, so a town its mayor later disbands stays disbanded.
CREATE TABLE towns_heritage_activation (
    site_id      TEXT   NOT NULL PRIMARY KEY,
    town_id      TEXT   NOT NULL,
    activated_at BIGINT NOT NULL
);
