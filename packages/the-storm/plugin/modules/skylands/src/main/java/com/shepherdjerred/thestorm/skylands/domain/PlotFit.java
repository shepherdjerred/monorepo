package com.shepherdjerred.thestorm.skylands.domain;

/**
 * Terrain checks never reserve or hollow a whole district. Only individual footprints are fitted.
 */
public final class PlotFit {
  private final TerrainWindow terrain;

  public PlotFit(TerrainWindow terrain) {
    this.terrain = terrain;
  }

  public boolean fits(SkyPiece piece) {
    var size = piece.size();
    if (piece.origin().y() - 3 < LayeredLandscape.MIN_Y
        || piece.origin().y() + size.y() + 1 >= LayeredLandscape.MAX_Y) return false;
    for (var x = 0; x < size.x(); x++) {
      for (var z = 0; z < size.z(); z++) {
        if (!columnFits(piece, x, z)) return false;
      }
    }
    return true;
  }

  private boolean columnFits(SkyPiece piece, int x, int z) {
    var p = piece.origin().add(new SkyPosition(x, 0, z));
    if (!terrain.footing(p, 3)) return false;
    if (terrain.column(p.x(), p.z()).water(p.y() + 1)) return false;
    for (var y = piece.template().embeddedHeight() + 1; y <= piece.size().y(); y++) {
      if (!terrain.air(p.above(y))) return false;
    }
    return true;
  }
}
