package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.ability.Abilities;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageLog;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class RunnerRulesTest {

  private static final MatchSettings SETTINGS =
      new MatchSettings(
          4,
          2,
          60,
          Duration.ofSeconds(90),
          Duration.ofSeconds(15),
          Duration.ofSeconds(15),
          Duration.ofMinutes(1),
          Duration.ofSeconds(20),
          Duration.ofSeconds(10),
          Duration.ofSeconds(5),
          true,
          com.shepherdjerred.thestorm.rwf.domain.kit.KitPool.ALL);

  private static RwfMatch countingDownTo(java.time.Instant startsAt) {
    return new RwfMatch(
        SETTINGS,
        Samples.MATCH,
        Samples.SEED,
        new Phase.Countdown(startsAt, T0, 0, Ballot.NONE),
        Optional.empty(),
        List.of(),
        List.of(),
        List.of(),
        DamageLog.EMPTY,
        Map.of(),
        Abilities.NONE);
  }

  @Test
  void botsWalkInOverHalfOfWhatIsLeftOfTheCountdownAndNeverANegativeSpan() {
    assertThat(RunnerRules.arrivalBudget(countingDownTo(T0.plusSeconds(60)), T0))
        .isEqualTo(Duration.ofSeconds(30));
    // The map loaded just after the countdown ran out, before the tick moved the match on.
    assertThat(RunnerRules.arrivalBudget(countingDownTo(T0), T0.plusMillis(200)))
        .isEqualTo(Duration.ZERO);
  }

  @Test
  void lobbyArrivalsFitAShortCountdownWithoutChangingTheShippedBudget() {
    assertThat(RunnerRules.arrivalBudget(RwfMatch.open(SETTINGS, Samples.MATCH, Samples.SEED), T0))
        .isEqualTo(Duration.ofSeconds(15));
    var shortCountdown =
        new MatchSettings(
            1,
            1,
            101,
            Duration.ofSeconds(6),
            SETTINGS.relaxEvery(),
            SETTINGS.endLinger(),
            SETTINGS.minimumRewardLength(),
            Duration.ZERO,
            Duration.ZERO,
            Duration.ZERO,
            false,
            com.shepherdjerred.thestorm.rwf.domain.kit.KitPool.ALL);
    assertThat(
            RunnerRules.arrivalBudget(
                RwfMatch.open(shortCountdown, Samples.MATCH, Samples.SEED), T0))
        .isEqualTo(Duration.ofSeconds(3));
  }

  @Test
  void allSixtyThreeBotsArriveBeforeTheActualPostVisitCountdownEnds() {
    var settings = arrivalSettings(Duration.ofSeconds(3));
    var candidate = new Ballot.Candidate("harbour", "Harbour", "Builders");
    var ballot =
        new Ballot(
            List.of(candidate),
            Map.of(),
            Optional.of(candidate.mapId()),
            Optional.of(
                new Ballot.Visits(Duration.ofSeconds(90), Optional.of(T0.minusSeconds(90)))));
    var waiting = waiting(settings, ballot);
    var countdown =
        switch (waiting.on(new MatchEvent.Tick(T0, Map.of()))) {
          case Result.Ok<RwfMatch.Step, MatchError>(var step) ->
              (Phase.Countdown) step.match().phase();
          case Result.Err<RwfMatch.Step, MatchError>(var error) -> throw new AssertionError(error);
        };
    assertThat(countdown.startsAt()).isEqualTo(T0.plusSeconds(3));
    assertThat(RunnerRules.arrivalBudget(waiting, T0)).isEqualTo(Duration.ofMillis(1500));
    var bots =
        IntStream.rangeClosed(1, 63)
            .mapToObj(id -> new CombatantId.Bot("personality-" + id, new UUID(1, id)))
            .toList();
    var released = new ArrayList<CombatantId.Bot>();
    var joined = new ArrayList<CombatantId.Bot>();
    var arrivals = new BotArrivals(released::add);
    arrivals.schedule(bots, Samples.SEED, T0, RunnerRules.arrivalBudget(waiting, T0));
    arrivals.arrive(countdown.startsAt().minusMillis(1), joined::add);
    arrivals.release();
    assertThat(joined).containsExactlyElementsOf(bots);
    assertThat(released).isEmpty();
    assertThat(arrivals.size()).isZero();
  }

  @Test
  void visitLeadZeroAdmitsImmediatelyWhileOrdinaryBallotsKeepTheFullCountdownBudget() {
    var settings = arrivalSettings(Duration.ZERO);
    var candidate = new Ballot.Candidate("harbour", "Harbour", "Builders");
    var visit =
        new Ballot(
            List.of(candidate),
            Map.of(),
            Optional.of(candidate.mapId()),
            Optional.of(
                new Ballot.Visits(Duration.ofSeconds(90), Optional.of(T0.minusSeconds(90)))));
    assertThat(RunnerRules.arrivalBudget(waiting(settings, visit), T0)).isEqualTo(Duration.ZERO);
    var ordinary = new Ballot(List.of(candidate), Map.of(), Optional.of(candidate.mapId()));
    assertThat(RunnerRules.arrivalBudget(waiting(settings, ordinary), T0))
        .isEqualTo(Duration.ofSeconds(30));
  }

  private static MatchSettings arrivalSettings(Duration lead) {
    return new MatchSettings(
        1,
        1,
        64,
        Duration.ofSeconds(60),
        Duration.ofSeconds(60),
        Duration.ZERO,
        Duration.ZERO,
        lead,
        Duration.ofSeconds(3),
        Duration.ofSeconds(3),
        true,
        com.shepherdjerred.thestorm.rwf.domain.kit.KitPool.ALL);
  }

  private static RwfMatch waiting(MatchSettings settings, Ballot ballot) {
    return new RwfMatch(
        settings,
        Samples.MATCH,
        Samples.SEED,
        new Phase.Lobby(Optional.of(T0.minusSeconds(90)), ballot),
        Optional.of(Samples.twoTeams()),
        List.of(Combatant.joining(Samples.ALICE, "Alice", T0.minusSeconds(90))),
        List.of(),
        List.of(),
        DamageLog.EMPTY,
        Map.of(),
        Abilities.NONE);
  }
}
