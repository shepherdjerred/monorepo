-- One row means that flag is on for visitors. A missing row stays off.
-- Flags never change world gamerules.

CREATE TABLE creative_flags (
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  flag TEXT NOT NULL,
  PRIMARY KEY (plot_x, plot_z, flag),
  FOREIGN KEY (plot_x, plot_z) REFERENCES creative_claims (plot_x, plot_z) ON DELETE CASCADE
);
