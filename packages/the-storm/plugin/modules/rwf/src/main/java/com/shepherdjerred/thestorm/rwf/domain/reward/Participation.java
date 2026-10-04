// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onDeath/getPlayed,
// and redwarfare-arcade/src/me/libraryaddict/arcade/game/GameTeam.java, getRewardable); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.reward;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Instant;
import java.util.Optional;

/**
 * One combatant's part in a match, as far as rewards care.
 *
 * @param id who
 * @param team their team
 * @param presentAtStart whether they were in the match when it went live (Red Warfare's "played")
 * @param diedAt when they died, if they did
 * @param leftAt when they left or disconnected, if they did
 * @param forfeited whether they threw the match away (suicide in the first minute, in the original)
 */
public record Participation(
    CombatantId id,
    TeamColor team,
    boolean presentAtStart,
    Optional<Instant> diedAt,
    Optional<Instant> leftAt,
    boolean forfeited) {

  /** Whether they stayed until they died or the match ended. */
  public boolean stayedToTheEnd() {
    if (leftAt.isEmpty()) {
      return true;
    }
    return diedAt.isPresent() && !leftAt.orElseThrow().isBefore(diedAt.orElseThrow());
  }
}
