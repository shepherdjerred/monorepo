package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.BodyRole;

/**
 * What happens to the two bodies when a player enters, leaves, or comes back after a crash.
 * Creative experience, effects and items are never added to the survival body.
 */
public final class BodySwap {

  private BodySwap() {}

  /** What a login does with a stored survival body. */
  public enum Arrival {
    /** No survival body is stored. */
    NONE,
    /** The player is still in creative. Keep that visit and do not apply survival. */
    RESUME,
    /** The player is outside. Put the survival body back and drop the creative one. */
    RESTORE
  }

  /** Why an enter command is refused, or how the visit opens. */
  public enum Verdict {
    OPEN_AT_SPAWN,
    OPEN_HERE,
    ALREADY,
    RESTORE_FIRST,
    BUSY,
    IN_ARENA,
    SEALED
  }

  /**
   * Facts known when the player asks to enter.
   *
   * @param inCreative they are standing in the creative world
   * @param survivalHeld a survival body is already held for them
   * @param busy a save or restore is still in flight
   * @param inArena they are joining, fighting or watching an arena
   * @param otherWorldSealed their current world is sealed and is not creative
   */
  public record Attempt(
      boolean inCreative,
      boolean survivalHeld,
      boolean busy,
      boolean inArena,
      boolean otherWorldSealed) {}

  /** Login while {@code survivalStored} may still need to be put back. */
  public static Arrival onJoin(boolean inCreative, boolean survivalStored) {
    if (!survivalStored) {
      return Arrival.NONE;
    }
    return inCreative ? Arrival.RESUME : Arrival.RESTORE;
  }

  /** The enter command. A held survival body blocks a second visit until it is restored. */
  public static Verdict enter(Attempt attempt) {
    if (attempt.busy()) {
      return Verdict.BUSY;
    }
    if (attempt.survivalHeld() && attempt.inCreative()) {
      return Verdict.ALREADY;
    }
    if (attempt.survivalHeld()) {
      return Verdict.RESTORE_FIRST;
    }
    if (attempt.inArena()) {
      return Verdict.IN_ARENA;
    }
    if (attempt.otherWorldSealed()) {
      return Verdict.SEALED;
    }
    if (attempt.inCreative()) {
      return Verdict.OPEN_HERE;
    }
    return Verdict.OPEN_AT_SPAWN;
  }

  /**
   * The body a clean leave puts back. {@code creative} is ignored on purpose: its experience,
   * effects and items do not come back.
   */
  public static VisitBody restored(VisitBody survival, VisitBody creative) {
    if (survival.role() != BodyRole.SURVIVAL || creative.role() != BodyRole.CREATIVE) {
      throw new IllegalArgumentException("leave restores survival and discards creative");
    }
    if (!survival.snapshot().player().equals(creative.snapshot().player())) {
      throw new IllegalArgumentException("the bodies are for different players");
    }
    return survival;
  }
}
