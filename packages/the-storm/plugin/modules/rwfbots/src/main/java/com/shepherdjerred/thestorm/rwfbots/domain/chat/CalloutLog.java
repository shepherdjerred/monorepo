package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.team.Callout;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * The team calls said lately, so a bot does not repeat what a teammate just said: in production 15%
 * of the team's enemy calls named a spot within 16 blocks of one a teammate made in the 10 seconds
 * before. A call is a repeat when a teammate made one of the same kind about the same place (or
 * within {@link #SAME_SPOT} blocks) within {@link #ENEMY_WINDOW} for a sighting, {@link
 * #OBJECTIVE_WINDOW} for anything else. A sighting addressed to a human is not repeated by one
 * addressed to nobody or to someone else. Main thread only.
 */
public final class CalloutLog {

  /** Two calls about places this close are about the same spot. */
  public static final double SAME_SPOT = 16;

  /** How long an enemy call covers its spot. */
  public static final Duration ENEMY_WINDOW = Duration.ofSeconds(10);

  /** How long an objective call covers its moment. */
  public static final Duration OBJECTIVE_WINDOW = Duration.ofSeconds(20);

  private final Deque<Entry> said = new ArrayDeque<>();

  private record Entry(Callout callout, Instant at) {}

  /** Whether a teammate already said {@code callout} lately. */
  public boolean repeats(Callout callout, Instant now) {
    prune(now);
    return said.stream()
        .anyMatch(
            entry ->
                entry.callout().team().equals(callout.team())
                    && entry.callout().kind() == callout.kind()
                    && now.isBefore(entry.at().plus(window(callout.kind())))
                    && samePlace(entry.callout(), callout)
                    && covers(entry.callout(), callout));
  }

  /** Records that {@code callout} was said at {@code now}. */
  public void said(Callout callout, Instant now) {
    prune(now);
    said.addLast(new Entry(callout, now));
  }

  private static Duration window(Callout.Kind kind) {
    return kind == Callout.Kind.ENEMY ? ENEMY_WINDOW : OBJECTIVE_WINDOW;
  }

  private static boolean samePlace(Callout earlier, Callout later) {
    return earlier.place().equals(later.place())
        || earlier.pos().horizontalDistance(later.pos()) <= SAME_SPOT;
  }

  /** Whether {@code earlier} told the team what {@code later} would. */
  private static boolean covers(Callout earlier, Callout later) {
    return later.subject().isEmpty() || later.subject().equals(earlier.subject());
  }

  private void prune(Instant now) {
    while (!said.isEmpty() && !now.isBefore(said.peekFirst().at().plus(OBJECTIVE_WINDOW)))
      said.removeFirst();
  }
}
