package com.shepherdjerred.thestorm.rwf.app;

import java.util.concurrent.CompletableFuture;

/**
 * Which Red Warfare match features are switched on, read once per match from the managed flags. A
 * feature that is off plays as the match did before it existed.
 *
 * @param matchFlow the map vote, the preview over the chosen map and the freeze at the spawns; off,
 *     the next map is drawn at random and the match goes live when the countdown ends
 * @param carryOver humans stay in for the next match when one ends on its own
 * @param deathFeed death messages in team colours, assists, stolen kills, the killer's health and
 *     kills on the tab list
 * @param teamChat team chat, dead chat and the auto team chat toggle
 * @param spectatorTools the dead's compass, player menu, follow and the killer's view
 * @param bombEffects Red Warfare's bomb sounds at map volume, smoke, the explosion particle and the
 *     hologram's progress bars
 * @param stats {@code /rwf stats}, {@code /rwf top}, {@code /rwf history} and the lobby leaderboard
 */
public record RwfFeatures(
    boolean matchFlow,
    boolean carryOver,
    boolean deathFeed,
    boolean teamChat,
    boolean spectatorTools,
    boolean bombEffects,
    boolean stats) {

  /** Every feature off: the match as it was. */
  public static final RwfFeatures NONE =
      new RwfFeatures(false, false, false, false, false, false, false);

  /** Every feature on. */
  public static final RwfFeatures ALL = new RwfFeatures(true, true, true, true, true, true, true);

  /** Reads the managed flags. A failure is an outage, not an answer: callers keep what they had. */
  @FunctionalInterface
  public interface Source extends AutoCloseable {

    CompletableFuture<RwfFeatures> evaluate();

    @Override
    default void close() {}

    /** A source that always answers {@code features}. */
    static Source fixed(RwfFeatures features) {
      return () -> CompletableFuture.completedFuture(features);
    }
  }
}
