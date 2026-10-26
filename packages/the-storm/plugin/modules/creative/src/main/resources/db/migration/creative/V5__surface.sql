-- Empty means the generator default: grass floor, stone wall, plains biome.
-- Setting a choice does not rewrite the plot.

ALTER TABLE creative_claims ADD COLUMN floor TEXT;
ALTER TABLE creative_claims ADD COLUMN wall TEXT;
ALTER TABLE creative_claims ADD COLUMN biome TEXT;
