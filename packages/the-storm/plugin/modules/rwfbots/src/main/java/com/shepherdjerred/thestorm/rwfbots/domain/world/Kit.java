package com.shepherdjerred.thestorm.rwfbots.domain.world;

import java.util.Locale;
import java.util.Optional;

/**
 * The kits bots know how to play and read. Milestone one ships the first four.
 *
 * <p>rwf may run kits bots have never heard of (a human on a newly added kit). Live match data is
 * read with {@link #closest}, which never fails; repo-owned configuration is read with {@link
 * #known} and refuses an unknown id.
 */
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

  /** rwf's id for this kit, lower-case, as kit content and match state name it. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The kit rwf names {@code id}, if bots know it. Ids are matched exactly, lower-case. */
  public static Optional<Kit> known(String id) {
    for (var kit : values()) {
      if (kit.id().equals(id)) {
        return Optional.of(kit);
      }
    }
    return Optional.empty();
  }

  /**
   * The kit rwf names {@code id}, or, when bots do not know it, the known kit that behaves most
   * like what can be {@code seen} of its wearer: an invisible wearer reads as {@link #GHOST}, one
   * carrying a bow as {@link #LONGBOW}, and anyone else as {@link #TROOPER}, the plain melee kit.
   * Only observable traits decide, because nothing else about an unknown kit is known; a disguise
   * cannot be seen, so no unknown kit reads as {@link #SPY}.
   */
  public static Kit closest(String id, Traits seen) {
    return known(id)
        .orElseGet(
            () -> {
              if (seen.invisible()) {
                return GHOST;
              }
              return seen.bow() ? LONGBOW : TROOPER;
            });
  }

  /**
   * What can be observed of a combatant without knowing their kit.
   *
   * @param bow whether they carry a bow or crossbow
   * @param invisible whether they are invisible
   */
  public record Traits(boolean bow, boolean invisible) {

    /** Nothing observed. */
    public static final Traits NONE = new Traits(false, false);
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
