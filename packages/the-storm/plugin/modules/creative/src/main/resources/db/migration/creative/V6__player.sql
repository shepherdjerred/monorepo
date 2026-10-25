-- Merge anchor. Both null when the plot stands alone. Both name the anchor plot when merged.
-- Ratings and comments belong to a claim row and leave with it.

ALTER TABLE creative_claims ADD COLUMN cluster_x INTEGER;
ALTER TABLE creative_claims ADD COLUMN cluster_z INTEGER;

CREATE TABLE creative_ratings (
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  player TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (plot_x, plot_z, player),
  FOREIGN KEY (plot_x, plot_z) REFERENCES creative_claims (plot_x, plot_z) ON DELETE CASCADE
);

CREATE TABLE creative_comments (
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  player TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  posted INTEGER NOT NULL,
  PRIMARY KEY (plot_x, plot_z, player, posted),
  FOREIGN KEY (plot_x, plot_z) REFERENCES creative_claims (plot_x, plot_z) ON DELETE CASCADE
);
