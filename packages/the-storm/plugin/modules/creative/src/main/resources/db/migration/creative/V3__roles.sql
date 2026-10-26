-- One row is one player's role on a plot. Existing rows could already build, so they are trusted.
ALTER TABLE creative_trust ADD COLUMN role TEXT NOT NULL DEFAULT 'trusted';
