package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

/** Scores nearby firing cover: elevation helps, but a retreat matters more than a high dead end. */
public final class RangedPosition {

  /**
   * How many blocks further an archer will walk to hold cover for each block it stands above the
   * point it watches: a balcony or a wall top over a level spot just as near.
   */
  public static final double HEIGHT_WORTH = 1.0;

  /** Height beyond this many blocks earns nothing more. */
  public static final double HEIGHT_CAP = 4;

  private RangedPosition() {}

  public record Candidate(double travel, double elevation, int retreats, double range) {}

  public static double cost(Candidate point, ArchetypeBias.Range band) {
    var outsideBand =
        point.range() < band.min()
            ? band.min() - point.range()
            : Math.max(0, point.range() - band.max());
    return point.travel()
        - 0.6 * Math.clamp(point.elevation(), -3, 5)
        + (point.retreats() == 0 ? 8 : -Math.min(3, point.retreats()) * 0.5)
        + outsideBand * 2;
  }

  /** The travel, in blocks, standing {@code elevation} blocks above the watched point is worth. */
  public static double heightAdvantage(double elevation) {
    return HEIGHT_WORTH * Math.clamp(elevation, 0, HEIGHT_CAP);
  }
}
