package com.shepherdjerred.thestorm.core.expansion;

/** Required, repository-owned bounds for expanded commands and text letters. */
public record ExpansionSettings(
    int letterLength,
    int letterIntervalSeconds,
    int inboxLimit,
    int entityLimit,
    int effectRadius,
    int jailRadius,
    int confirmationSeconds) {
  public ExpansionSettings {
    if (letterLength < 1
        || letterLength > 2000
        || letterIntervalSeconds < 1
        || inboxLimit < 1
        || entityLimit < 1
        || entityLimit > 100
        || effectRadius < 1
        || effectRadius > 64
        || jailRadius < 1
        || jailRadius > 64
        || confirmationSeconds < 1
        || confirmationSeconds > 60) {
      throw new IllegalArgumentException("invalid expansion bounds");
    }
  }
}
