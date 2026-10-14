package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

/** Scores nearby firing cover: elevation helps, but a retreat matters more than a high dead end. */
public final class RangedPosition {
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
}
