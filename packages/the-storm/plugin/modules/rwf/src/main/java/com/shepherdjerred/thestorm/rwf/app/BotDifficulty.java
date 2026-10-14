package com.shepherdjerred.thestorm.rwf.app;

/** A host-selected skill band; personalities retain their order and individual lever offsets. */
public enum BotDifficulty {
  EASY("Easy", 0.15, 0.40),
  NORMAL("Normal", 0.35, 0.65),
  HARD("Hard", 0.60, 0.85);

  private final String displayName;
  private final double minimum;
  private final double maximum;

  BotDifficulty(String displayName, double minimum, double maximum) {
    this.displayName = displayName;
    this.minimum = minimum;
    this.maximum = maximum;
  }

  public String displayName() {
    return displayName;
  }

  /** Maps a personality's base skill into the selected band. */
  public double skill(double base) {
    if (!(base >= 0 && base <= 1)) {
      throw new IllegalArgumentException("personality skill must be 0..1");
    }
    return minimum + (maximum - minimum) * base;
  }
}
