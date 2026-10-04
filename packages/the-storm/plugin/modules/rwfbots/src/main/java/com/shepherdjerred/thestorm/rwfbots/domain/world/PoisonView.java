package com.shepherdjerred.thestorm.rwfbots.domain.world;

/**
 * The late-match poison. Once active it hurts everyone and hurts more within {@code bombRadius} of
 * their own team's bomb; {@code intensity} grows as the match drags on.
 *
 * @param active whether poison has started
 * @param startedTick the tick it started, meaningful only while active
 * @param bombRadius the radius around a team's own bomb that takes extra damage
 * @param intensity how hard it hits, from 0 at the start upwards
 */
public record PoisonView(boolean active, long startedTick, double bombRadius, double intensity) {

  public static final PoisonView NONE = new PoisonView(false, 0, 15, 0);

  public PoisonView {
    if (!(bombRadius >= 0) || !(intensity >= 0)) {
      throw new IllegalArgumentException("poison radius and intensity must be non-negative");
    }
    if (active && startedTick < 0) {
      throw new IllegalArgumentException("poison start tick must not be negative");
    }
  }

  /** Poison that started at {@code tick} with the default radius. */
  public static PoisonView startedAt(long tick, double intensity) {
    return new PoisonView(true, tick, NONE.bombRadius, intensity);
  }
}
