package com.shepherdjerred.thestorm.spells.domain.geometry;

/** Farm: crops grow by a number of stages, never past ripe. */
public final class Growth {

  private Growth() {}

  /** The age after growing {@code stages} from {@code age}, capped at {@code maximum}. */
  public static int grow(int age, int maximum, int stages) {
    if (age < 0 || maximum < 0 || stages < 0) {
      throw new IllegalArgumentException("ages and stages cannot be negative");
    }
    return Math.min(maximum, age + stages);
  }

  /** True when a crop at {@code age} can still grow. */
  public static boolean canGrow(int age, int maximum) {
    return age < maximum;
  }
}
