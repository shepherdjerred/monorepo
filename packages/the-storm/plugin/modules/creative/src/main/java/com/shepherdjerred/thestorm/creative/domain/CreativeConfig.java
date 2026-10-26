package com.shepherdjerred.thestorm.creative.domain;

import java.util.List;

/**
 * Repository-owned creative world settings. The grid numbers are the 2016 measurement; a file that
 * disagrees with {@link PlotGrid#recovered()} is refused because the chunk template was captured
 * for that grid. {@code plots} is the historical catalog. The plugin reads it and never writes it.
 */
public record CreativeConfig(
    String world,
    int plotWidth,
    int roadWidth,
    int roadOffsetX,
    int roadOffsetZ,
    int surfaceY,
    double borderCenterX,
    double borderCenterZ,
    double borderSize,
    int claimCap,
    int entityCap,
    int brushRadius,
    int commentLength,
    int commentCap,
    List<RecoveredPlot> plots) {

  public CreativeConfig {
    if (!"creative".equals(world)) {
      throw new IllegalArgumentException("creative world must be named creative");
    }
    if (plotWidth != PlotGrid.PLOT_WIDTH
        || roadWidth != PlotGrid.ROAD_WIDTH
        || roadOffsetX != PlotGrid.ROAD_OFFSET_X
        || roadOffsetZ != PlotGrid.ROAD_OFFSET_Z
        || surfaceY != PlotGrid.SURFACE_Y) {
      throw new IllegalArgumentException("creative grid does not match the recovered template");
    }
    if (!Double.isFinite(borderCenterX)
        || !Double.isFinite(borderCenterZ)
        || !Double.isFinite(borderSize)) {
      throw new IllegalArgumentException("creative border must be finite");
    }
    if (Math.abs(borderCenterX) > 29_999_984
        || Math.abs(borderCenterZ) > 29_999_984
        || borderSize < 1
        || borderSize > 59_999_968) {
      throw new IllegalArgumentException("creative border must fit Minecraft's world bounds");
    }
    if (Math.hypot(PlotGrid.SPAWN_X - borderCenterX, PlotGrid.SPAWN_Z - borderCenterZ)
        >= borderSize / 2) {
      throw new IllegalArgumentException("creative spawn must be inside its circular border");
    }
    if (claimCap < 0 || claimCap > 100) {
      throw new IllegalArgumentException("claimCap must be 0..100");
    }
    if (entityCap < 1 || entityCap > 1000) {
      throw new IllegalArgumentException("entityCap must be 1..1000");
    }
    if (brushRadius < 1 || brushRadius > 16) {
      throw new IllegalArgumentException("brushRadius must be 1..16");
    }
    if (commentLength < 1 || commentLength > 200) {
      throw new IllegalArgumentException("commentLength must be 1..200");
    }
    if (commentCap < 1 || commentCap > 100) {
      throw new IllegalArgumentException("commentCap must be 1..100");
    }
    plots = List.copyOf(plots);
    var catalog = PlotCatalog.of(plots);
    if (catalog.size() != plots.size()) {
      throw new IllegalArgumentException("creative plot catalog dropped a row");
    }
  }

  /** The recovered plots, keyed for membership checks. */
  public PlotCatalog catalog() {
    return PlotCatalog.of(plots);
  }

  public PlotGrid grid() {
    return PlotGrid.recovered();
  }
}
