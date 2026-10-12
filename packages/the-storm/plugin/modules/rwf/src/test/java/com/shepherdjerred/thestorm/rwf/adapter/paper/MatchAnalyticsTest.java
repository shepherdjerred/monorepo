package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.analytics.GameActivity;
import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class MatchAnalyticsTest {
  private static final UUID PLAYER = new UUID(1, 1);
  private static final CombatantId HUMAN = new CombatantId.Human(PLAYER);
  private static final CombatantId BOT = new CombatantId.Bot("test", new UUID(2, 2));

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
    events.accept(
        new MatchNotification(
            new MatchEvent.PickKit(HUMAN, "longbow"),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.COUNTDOWN, List.of(HUMAN, BOT))));
    events.accept(
        new MatchNotification(
            new MatchEvent.PickKit(BOT, "trooper"),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.COUNTDOWN, List.of(HUMAN, BOT))));
    events.accept(
        new MatchNotification(
            new MatchEvent.Vote(HUMAN, "harbour"),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.COUNTDOWN, List.of(HUMAN, BOT))));
    events.accept(
        new MatchNotification(
            new MatchEvent.ForceStart(Instant.EPOCH),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.LIVE, List.of(HUMAN, BOT))));
    events.accept(
        new MatchNotification(
            new MatchEvent.Stop(),
            List.of(),
            snapshot(MatchSnapshot.PhaseKind.ENDED, List.of(HUMAN, BOT))));
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
        .containsKeys("kills", "assists", "duration_s", "map", "kit");
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
