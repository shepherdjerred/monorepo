-- Mutable creative claims. The historical catalog in creative.yml is never written.
-- A row with released = true hides a catalog owner. counts_toward_cap is true only
-- for a plot a player claimed. Restored plots and staff assigns do not count.
-- owner is null when the row only stores a name, description, or trust list.

CREATE TABLE creative_claims (
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  owner TEXT,
  released BOOLEAN NOT NULL,
  counts_toward_cap BOOLEAN NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  PRIMARY KEY (plot_x, plot_z)
);

CREATE TABLE creative_trust (
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  member TEXT NOT NULL,
  PRIMARY KEY (plot_x, plot_z, member),
  FOREIGN KEY (plot_x, plot_z) REFERENCES creative_claims (plot_x, plot_z) ON DELETE CASCADE
);
