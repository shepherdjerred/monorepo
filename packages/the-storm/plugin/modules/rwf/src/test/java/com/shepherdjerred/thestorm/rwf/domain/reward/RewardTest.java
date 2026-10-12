package com.shepherdjerred.thestorm.rwf.domain.reward;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOT_1;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.reward.RewardEligibility.Award;
import com.shepherdjerred.thestorm.rwf.domain.reward.RewardEligibility.Reason;
import com.shepherdjerred.thestorm.rwf.domain.reward.RewardEligibility.Span;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class RewardTest {

  private static final Span TEN_MINUTES = new Span(T0, T0.plus(Duration.ofMinutes(10)));
  private static final Duration MINIMUM = Duration.ofMinutes(1);

  private static Participation played(CombatantId id, TeamColor team) {
    return new Participation(id, team, true, Optional.empty(), Optional.empty(), false);
  }

  @Nested
  final class Scaling {

    @Test
    void aFullHumanMatchPaysTheBaseAndABotMatchAQuarter() {
      assertThat(Payout.scale(Payout.WIN, 1.0)).isEqualTo(3);
      assertThat(Payout.scale(Payout.WIN, 0.0)).isEqualTo(1);
      assertThat(Payout.scale(Payout.WIN, 0.5)).isEqualTo(2);
      assertThat(Payout.scale(Payout.LOSE, 1.0)).isEqualTo(1);
      assertThat(Payout.scale(Payout.LOSE, 0.0)).isZero();
      assertThat(Payout.scale(Payout.KILL, 1.0)).isZero();
    }

    @Test
    void theHumanShareIsAFraction() {
      assertThat(Payout.humanShare(2, 4)).isEqualTo(0.5);
      assertThatThrownBy(() -> Payout.humanShare(5, 4))
          .isInstanceOf(IllegalArgumentException.class);
      assertThatThrownBy(() -> Payout.scale(3, 1.5)).isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Nested
  final class Eligibility {

    @Test
    void stayingToTheEndOrDyingFirstIsEligible() {
      var stayed = played(ALICE, TeamColor.RED);
      var died =
          new Participation(
              BOB, TeamColor.RED, true, Optional.of(T0.plusSeconds(100)), Optional.empty(), false);
      var diedThenLeft =
          new Participation(
              CAROL,
              TeamColor.RED,
              true,
              Optional.of(T0.plusSeconds(100)),
              Optional.of(T0.plusSeconds(200)),
              false);

      for (var participant : List.of(stayed, died, diedThenLeft)) {
        assertThat(RewardEligibility.eligible(participant, TEN_MINUTES, MINIMUM)).isTrue();
      }
    }

    @Test
    void leavingAliveForfeitingBotsAndLateComersAreNot() {
      var leftAlive =
          new Participation(
              ALICE, TeamColor.RED, true, Optional.empty(), Optional.of(T0.plusSeconds(50)), false);
      var forfeited =
          new Participation(BOB, TeamColor.RED, true, Optional.empty(), Optional.empty(), true);
      var bot = played(BOT_1, TeamColor.RED);
      var late =
          new Participation(CAROL, TeamColor.RED, false, Optional.empty(), Optional.empty(), false);

      for (var participant : List.of(leftAlive, forfeited, bot, late)) {
        assertThat(RewardEligibility.eligible(participant, TEN_MINUTES, MINIMUM)).isFalse();
      }
    }

    @Test
    void aMatchShorterThanTheMinimumPaysNobody() {
      var brief = new Span(T0, T0.plusSeconds(59));

      assertThat(RewardEligibility.eligible(played(ALICE, TeamColor.RED), brief, MINIMUM))
          .isFalse();
      assertThat(
              RewardEligibility.settle(
                  List.of(played(ALICE, TeamColor.RED)),
                  Optional.of(TeamColor.RED),
                  brief,
                  MINIMUM))
          .isEmpty();
    }

    @Test
    void settlementPaysWinnersThreeLosersOneScaledByTheHumanShare() {
      var roster =
          List.of(
              played(ALICE, TeamColor.RED),
              played(BOB, TeamColor.BLUE),
              played(BOT_1, TeamColor.BLUE),
              played(CAROL, TeamColor.BLUE));

      var awards =
          RewardEligibility.settle(roster, Optional.of(TeamColor.RED), TEN_MINUTES, MINIMUM);

      // Three of four combatants are human: 3 × (0.25 + 0.75 × 0.75) = 2.4375 → 2; 1 × 0.8125 → 1.
      assertThat(awards)
          .containsExactly(
              new Award(roster.get(0), Reason.WIN, 2),
              new Award(roster.get(1), Reason.LOSE, 1),
              new Award(roster.get(3), Reason.LOSE, 1));
    }

    @Test
    void aDrawPaysEveryoneTheLosersShare() {
      var roster = List.of(played(ALICE, TeamColor.RED), played(BOB, TeamColor.BLUE));

      var awards = RewardEligibility.settle(roster, Optional.empty(), TEN_MINUTES, MINIMUM);

      assertThat(awards).extracting(Award::reason).containsOnly(Reason.LOSE);
      assertThat(awards).extracting(Award::credits).containsOnly(1L);
    }

    @Test
    void aSpanCannotRunBackwards() {
      assertThatThrownBy(() -> new Span(T0, Instant.EPOCH))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }
}
