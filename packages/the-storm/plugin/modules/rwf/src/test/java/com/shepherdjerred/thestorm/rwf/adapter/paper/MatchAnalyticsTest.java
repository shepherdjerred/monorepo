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
                        id, "Player", Optional.empty(), Optional.empty(), true))
            .toList(),
        List.of(),
        Optional.empty(),
        Optional.empty(),
        Optional.empty());
  }
}
