package com.shepherdjerred.thestorm.shards.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Formats bonus fractions for players. */
public final class Percent {

  private Percent() {}

  /** A fraction as a percentage with at most one decimal: 0.25 is "25%", 0.035 is "3.5%". */
  public static String format(double fraction) {
    var percent =
        BigDecimal.valueOf(fraction)
            .movePointRight(2)
            .setScale(1, RoundingMode.HALF_UP)
            .stripTrailingZeros();
    return percent.toPlainString() + "%";
  }
}
