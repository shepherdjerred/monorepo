-- A preserved town can be registered before its mayor is identified.
-- Ordinary towns still require exactly one owner in the domain model.
ALTER TABLE towns_town ADD COLUMN historical_custody INTEGER NOT NULL DEFAULT 0
    CHECK (historical_custody IN (0, 1) AND (historical_custody = 0 OR kind = 'TOWN'));
