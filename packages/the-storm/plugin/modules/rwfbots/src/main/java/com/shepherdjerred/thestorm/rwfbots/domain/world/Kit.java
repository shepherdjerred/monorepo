package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** The kits a combatant can play. Milestone one ships the first four. */
public enum Kit {
  /** Iron sword, three golden apples, iron armor. */
  TROOPER(false, false, false),
  /** Punch III bow, stone sword. */
  LONGBOW(true, false, false),
  /** Power II bow, wooden sword with Knockback I. */
  SHORTBOW(true, false, false),
  /** A clock that teleports back to where it was 30 s ago, 30 s cooldown. */
  REWIND(false, false, false),
  /** Invisible while not wearing armor. */
  GHOST(false, true, false),
  /** Invisible, fast, fragile. */
  WRAITH(false, true, false),
  /** Appears to each enemy as one of their own teammates. */
  SPY(false, false, true);

  private final boolean bow;
  private final boolean invisibleKit;
  private final boolean disguiseKit;

  Kit(boolean bow, boolean invisibleKit, boolean disguiseKit) {
    this.bow = bow;
    this.invisibleKit = invisibleKit;
    this.disguiseKit = disguiseKit;
  }

  /** Whether the kit carries a bow. */
  public boolean hasBow() {
    return bow;
  }

  /** Whether the kit's wearer is invisible by default. */
  public boolean isInvisibleKit() {
    return invisibleKit;
  }

  /** Whether the kit's wearer appears as an enemy teammate. */
  public boolean isDisguiseKit() {
    return disguiseKit;
  }

  /** Whether the kit has golden apples to eat. */
  public boolean hasGapples() {
    return this == TROOPER;
  }

  /** Whether the kit has a timed ability to trigger with {@link BodyCommand.UseAbility}. */
  public boolean hasAbility() {
    return this == REWIND;
  }
}
