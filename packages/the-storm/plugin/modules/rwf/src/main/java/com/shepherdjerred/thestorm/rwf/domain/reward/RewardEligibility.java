// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/WinManager.java, setWin,
// and redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onDeath); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.reward;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Who is paid after a match. A combatant is paid when they are human, were there when the match
 * went live, stayed until they died or it ended, did not forfeit, and the match lasted at least
 * {@code minimumLength}. Winners get {@link Payout#WIN}, everyone else eligible {@link
 * Payout#LOSE}, each scaled by the roster's human share.
 */
public final class RewardEligibility {

  /** Red Warfare's grace period: a suicide inside it forfeits rewards. */
  public static final Duration FORFEIT_GRACE = Duration.ofMinutes(1);

  private RewardEligibility() {}

  public static boolean eligible(Participation participant, Span match, Duration minimumLength) {
    if (participant.id().isBot() || !participant.presentAtStart() || participant.forfeited()) {
      return false;
    }
    if (!participant.stayedToTheEnd()) {
      return false;
    }
    return match.length().compareTo(minimumLength) >= 0;
  }

  /** Everyone's award for {@code match}; winners first, as the original announced them. */
  public static List<Award> settle(
      List<Participation> roster, Optional<TeamColor> winner, Span match, Duration minimumLength) {
    var humans = roster.stream().filter(p -> !p.id().isBot()).count();
    var share = roster.isEmpty() ? 0 : Payout.humanShare((int) humans, roster.size());
    var awards = new ArrayList<Award>();
    for (var participant : roster) {
      if (!eligible(participant, match, minimumLength)) {
        continue;
      }
      var won = winner.filter(team -> team == participant.team()).isPresent();
      var base = won ? Payout.WIN : Payout.LOSE;
      var credits = Payout.scale(base, share);
      if (credits > 0) {
        awards.add(new Award(participant, won ? Reason.WIN : Reason.LOSE, credits));
      }
    }
    return List.copyOf(awards);
  }

  /** Why credits were paid. */
  public enum Reason {
    WIN,
    LOSE,
  }

  /**
   * Credits owed to one combatant.
   *
   * @param to who
   * @param reason why
   * @param credits how many
   */
  public record Award(Participation to, Reason reason, long credits) {}

  /**
   * When a match ran.
   *
   * @param liveAt when it went live
   * @param endedAt when it ended
   */
  public record Span(Instant liveAt, Instant endedAt) {

    public Span {
      if (endedAt.isBefore(liveAt)) {
        throw new IllegalArgumentException("a match cannot end before it starts");
      }
    }

    public Duration length() {
      return Duration.between(liveAt, endedAt);
    }
  }
}
