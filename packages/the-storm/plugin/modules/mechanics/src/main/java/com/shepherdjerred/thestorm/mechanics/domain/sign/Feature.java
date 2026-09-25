package com.shepherdjerred.thestorm.mechanics.domain.sign;

/**
 * One unlockable Mechanic-track feature. Each has its own section in {@code mechanics.yml} with an
 * on/off switch and the track level it needs.
 */
public enum Feature {
  HIDDEN_SWITCH("Hidden Switch"),
  LIGHT_SWITCH("Light Switch"),
  COOKING_POT("Cooking Pot"),
  BLOCK_DROPS("Block Drops"),
  ELEVATOR("Elevator"),
  BRIDGE("Bridge"),
  GATE("Gate"),
  DOOR("Door"),
  SIGN_COPIER("Sign Copier"),
  PAINTING_SWITCHER("Painting Switcher"),
  CRUSH("Crushing Piston"),
  BOUNCE("Bouncing Piston"),
  SUPER_STICKY("Super-Sticky Piston"),
  SUPER_PUSH("Super-Push Piston");

  private final String displayName;

  Feature(String displayName) {
    this.displayName = displayName;
  }

  /** The name players see, also the label of the feature's messages. */
  public String displayName() {
    return displayName;
  }
}
