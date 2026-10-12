// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/WinManager.java, setWin,
// and redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onDeath and deathAfk); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.reward;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Who is paid, or charged, after a match. A combatant counts when they are human, were there when
 * the match went live, stayed until they died or it ended, did not forfeit (a suicide or a quit
 * while it was live), and the match lasted at least {@code minimumLength}. Of those, anyone AFK for
 * the whole match loses {@link Payout#AFK_PENALTY} credits and earns nothing, as in Red Warfare;
 * winners get {@link Payout#WIN} and everyone else {@link Payout#LOSE}, each scaled by the roster's
 * human share.
 */
public final class RewardEligibility {

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
      if (participant.afk()) {
        awards.add(new Award(participant, Reason.AFK, -Payout.AFK_PENALTY));
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

  /** Why credits were paid or taken. */
  public enum Reason {
    WIN,
    LOSE,
    /** Taken, not paid: the player never looked around while alive in the live match. */
    AFK,
  }

  /**
   * Credits owed to, or taken from, one combatant.
   *
   * @param to who
   * @param reason why
   * @param credits how many; negative for {@link Reason#AFK}, positive otherwise
   */
  public record Award(Participation to, Reason reason, long credits) {

    public Award {
      if ((reason == Reason.AFK) != (credits < 0) || credits == 0) {
        throw new IllegalArgumentException(
            "an award pays a positive amount, or takes one for AFK: " + reason + " " + credits);
      }
    }
  }

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
