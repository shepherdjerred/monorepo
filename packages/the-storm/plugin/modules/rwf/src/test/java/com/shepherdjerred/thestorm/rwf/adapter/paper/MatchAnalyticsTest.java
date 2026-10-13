package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.analytics.GameActivity;
import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class MatchAnalyticsTest {
  private static final UUID PLAYER = new UUID(1, 1);
  private static final CombatantId HUMAN = new CombatantId.Human(PLAYER);
  private static final CombatantId BOT = new CombatantId.Bot("test", new UUID(2, 2));
  private static final CombatantId FRIEND = new CombatantId.Bot("test", new UUID(3, 3));

  private static final class Recording implements ProductAnalytics {
    private final List<Action> actions = new ArrayList<>();
    private final List<Mode> modes = new ArrayList<>();
    private final List<Map.Entry<GameEvent, Map<String, Object>>> games = new ArrayList<>();

    @Override
    public void game(UUID player, GameEvent event, Map<String, Object> properties) {
      assertThat(player).isEqualTo(PLAYER);
      games.add(Map.entry(event, ProductAnalytics.checked(properties)));
    }

    @Override
    public void interaction(UUID player, Action action) {
      assertThat(player).isEqualTo(PLAYER);
      actions.add(action);
    }

    @Override
    public void mode(UUID player, Mode mode) {
      assertThat(player).isEqualTo(PLAYER);
      modes.add(mode);
    }

    @Override
    public void afk(UUID player, boolean away) {}
  }

  @Test
  void forcedStopCompletesThePreviousHumanRosterBeforeRestoreClearsIt() {
    var recording = new Recording();
    var observer =
        new MatchAnalytics(new GameActivity(recording, ProductAnalytics.Mode.SEARCH_AND_DESTROY));
    observer.accept(
        new MatchNotification(
            new MatchEvent.Join(HUMAN, "Player", Instant.EPOCH),
            List.of(new MatchEffect.EnterLobby(HUMAN), new MatchEffect.EnterLobby(BOT)),
            snapshot(MatchSnapshot.PhaseKind.LOBBY, List.of(HUMAN, BOT))));
    observer.accept(
        new MatchNotification(
            new MatchEvent.ForceStart(Instant.EPOCH),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.LIVE, List.of(HUMAN, BOT))));
    observer.accept(
        new MatchNotification(
            new MatchEvent.Stop(),
            List.of(new MatchEffect.Restore(HUMAN), new MatchEffect.Restore(BOT)),
            snapshot(MatchSnapshot.PhaseKind.RESETTING, List.of())));
    observer.accept(
        new MatchNotification(
            new MatchEvent.ResetDone(),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.LOBBY, List.of())));
    assertThat(recording.actions)
        .containsExactly(
            ProductAnalytics.Action.RWF_JOINED,
            ProductAnalytics.Action.RWF_STARTED,
            ProductAnalytics.Action.RWF_COMPLETED,
            ProductAnalytics.Action.RWF_LEFT);
    assertThat(recording.modes)
        .containsExactly(ProductAnalytics.Mode.SEARCH_AND_DESTROY, ProductAnalytics.Mode.SURVIVAL);
  }

  @Test
  void humansKitsVotesAndFinishedMatchesAreNamedEventsAndBotsSendNone() {
    var recording = new Recording();
    var events = new RwfAnalytics(recording);
    var match = start(events);
    var stoppedAt = Samples.T0.plusSeconds(75);
    match = accept(events, match, new MatchEvent.Stop(), stoppedAt);
    var stopped = MatchSnapshot.of(match, stoppedAt);
    assertThat(stopped.phase()).isEqualTo(MatchSnapshot.PhaseKind.RESETTING);
    assertThat(stopped.combatants()).isEmpty();
    match = accept(events, match, new MatchEvent.ResetDone(), stoppedAt);
    accept(events, match, new MatchEvent.Stop(), stoppedAt);
    events.killstreakUsed(HUMAN, "compass", 2);
    events.killstreakUsed(BOT, "compass", 2);
    events.kitPurchased(HUMAN, "medic", 300);

    assertThat(recording.games)
        .extracting(Map.Entry::getKey)
        .containsExactly(
            ProductAnalytics.GameEvent.RWF_KIT_SELECTED,
            ProductAnalytics.GameEvent.RWF_MAP_VOTE,
            ProductAnalytics.GameEvent.RWF_MATCH_COMPLETED,
            ProductAnalytics.GameEvent.RWF_KILLSTREAK_USED,
            ProductAnalytics.GameEvent.RWF_KIT_PURCHASED);
    assertThat(recording.games.get(0).getValue()).containsEntry("kit", "longbow");
    assertThat(recording.games.get(1).getValue()).containsEntry("map", "harbour");
    assertThat(recording.games.get(2).getValue())
        .containsEntry("result", "stopped")
        .containsEntry("humans", 1L)
        .containsEntry("bots", 1L)
        .containsEntry("duration_s", 75L)
        .containsEntry("map", "harbour")
        .containsEntry("kit", "longbow")
        .containsEntry("survived", true)
        .containsKeys("kills", "assists", "duration_s", "map", "kit");
  }

  @Test
  void aNaturalEndEmitsItsResultOnceAndStoppingTheEndScreenDoesNotRepeatIt() {
    var recording = new Recording();
    var events = new RwfAnalytics(recording);
    var match = start(events);
    var endedAt = Samples.T0.plusSeconds(75);
    match =
        accept(
            events,
            match,
            new MatchEvent.Died(BOT, Optional.of(HUMAN), AttackType.MELEE, endedAt),
            endedAt);
    assertThat(MatchSnapshot.of(match, endedAt).phase()).isEqualTo(MatchSnapshot.PhaseKind.ENDED);
    accept(events, match, new MatchEvent.Stop(), endedAt);

    assertThat(recording.games)
        .filteredOn(entry -> entry.getKey() == ProductAnalytics.GameEvent.RWF_MATCH_COMPLETED)
        .singleElement()
        .satisfies(
            entry ->
                assertThat(entry.getValue())
                    .containsEntry("result", "win")
                    .containsEntry("duration_s", 75L)
                    .containsEntry("kills", 1));
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void aDepartedHumanCompletesOnceWithTheirFinalKitAndRosterCounts(boolean stopped) {
    var recording = new Recording();
    var events = new RwfAnalytics(recording);
    var match = start(events, stopped);
    var leftAt = Samples.T0.plusSeconds(30);
    match = accept(events, match, new MatchEvent.Leave(HUMAN, leftAt), leftAt);
    assertThat(match.members()).noneMatch(member -> member.id().equals(HUMAN));
    assertThat(match.departed()).hasSize(1);
    if (stopped) {
      assertThat(MatchSnapshot.of(match, leftAt).phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
      match = accept(events, match, new MatchEvent.Stop(), Samples.T0.plusSeconds(75));
    } else {
      assertThat(MatchSnapshot.of(match, leftAt).phase()).isEqualTo(MatchSnapshot.PhaseKind.ENDED);
      match = accept(events, match, new MatchEvent.Stop(), leftAt);
    }
    accept(events, match, new MatchEvent.ResetDone(), Samples.T0.plusSeconds(75));

    assertThat(recording.games)
        .filteredOn(entry -> entry.getKey() == ProductAnalytics.GameEvent.RWF_MATCH_COMPLETED)
        .singleElement()
        .satisfies(
            entry ->
                assertThat(entry.getValue())
                    .containsEntry("result", stopped ? "stopped" : "loss")
                    .containsEntry("kit", "longbow")
                    .containsEntry("humans", 1L)
                    .containsEntry("bots", stopped ? 2L : 1L)
                    .containsEntry("duration_s", stopped ? 75L : 30L)
                    .containsEntry("survived", false));
  }

  private static RwfMatch start(RwfAnalytics events) {
    return start(events, false);
  }

  private static RwfMatch start(RwfAnalytics events, boolean friend) {
    var match = RwfMatch.open(MatchSettings.RED_WARFARE, Samples.MATCH, Samples.SEED);
    var map = Samples.twoTeams();
    var setup =
        new ArrayList<MatchEvent>(
            List.of(
                new MatchEvent.Join(HUMAN, "Player", Samples.T0),
                new MatchEvent.Join(BOT, "Bot", Samples.T0),
                new MatchEvent.BallotOpened(
                    List.of(
                        new Ballot.Candidate(map.id(), map.name(), map.author()),
                        new Ballot.Candidate("yard", "Yard", map.author()))),
                new MatchEvent.PickKit(HUMAN, "longbow"),
                new MatchEvent.PickKit(BOT, "trooper"),
                new MatchEvent.Vote(HUMAN, map.id()),
                new MatchEvent.AssignTeam(HUMAN, TeamColor.RED),
                new MatchEvent.AssignTeam(BOT, TeamColor.BLUE)));
    if (friend) {
      setup.add(new MatchEvent.Join(FRIEND, "Friend", Samples.T0));
      setup.add(new MatchEvent.AssignTeam(FRIEND, TeamColor.RED));
    }
    setup.add(new MatchEvent.ForceStart(Samples.T0));
    setup.add(new MatchEvent.MapReady(map, Samples.T0));
    for (var event : setup) {
      match = accept(events, match, event, Samples.T0);
    }
    assertThat(MatchSnapshot.of(match, Samples.T0).phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    return match;
  }

  private static RwfMatch accept(
      RwfAnalytics events, RwfMatch match, MatchEvent event, Instant now) {
    var step =
        match
            .on(event)
            .fold(
                accepted -> accepted,
                error -> {
                  throw new AssertionError(event + " was refused: " + error);
                });
    events.accept(
        new MatchNotification(event, step.effects(), MatchSnapshot.of(step.match(), now)),
        step.match());
    return step.match();
  }

  private static MatchSnapshot snapshot(MatchSnapshot.PhaseKind phase, List<CombatantId> roster) {
    return new MatchSnapshot(
        new UUID(0, 1),
        phase,
        Instant.EPOCH,
        Optional.empty(),
        List.of(),
        roster.stream()
            .map(
                id ->
                    new MatchSnapshot.CombatantView(
                        id,
                        "Player",
                        Optional.empty(),
                        Optional.empty(),
                        true,
                        com.shepherdjerred.thestorm.rwf.domain.match.Score.ZERO))
            .toList(),
        List.of(),
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        Optional.empty());
  }
}
