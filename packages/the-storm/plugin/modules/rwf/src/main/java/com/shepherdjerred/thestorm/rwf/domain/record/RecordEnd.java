package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * How the match ended.
 *
 * @param tick ticks since the match went live
 * @param winner the winning team, or empty for a draw or a stop
 * @param reason why it ended
 * @param payouts credits paid, by pseudonym
 */
public record RecordEnd(
    long tick, Optional<TeamColor> winner, Reason reason, Map<String, Long> payouts) {

  /** Why a match ended. */
  public enum Reason {
    /** One team was left alive. */
    LAST_TEAM_STANDING,
    /** The last teams fell together. */
    DRAW,
    /** An admin or the plugin stopped it. */
    STOPPED,
  }

  public RecordEnd {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (winner.isPresent() != (reason == Reason.LAST_TEAM_STANDING)) {
      throw new IllegalArgumentException("exactly a LAST_TEAM_STANDING end names a winner");
    }
    payouts = Map.copyOf(new TreeMap<>(payouts));
  }
}
