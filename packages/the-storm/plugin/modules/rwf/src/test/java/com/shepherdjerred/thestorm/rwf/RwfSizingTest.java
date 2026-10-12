package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.time.Duration;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Commands exercise the real runner's bot draft, permissions and next-countdown preference. */
final class RwfSizingTest {
  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness start() {
    running = RwfHarness.start(directory);
    return requireNonNull(running);
  }

  private static PlayerMock operator(RwfHarness harness) {
    var player = harness.loadedPlayer("Operator");
    player.setOp(true);
    return player;
  }

  @Test
  void autoFillsTheTrainingYardToSixteenIncludingTheHuman() {
    var harness = start();
    var op = operator(harness);
    op.performCommand("rwf admin size auto");
    assertThat(RwfHarness.messages(op))
        .anyMatch(text -> text.contains("large 16 total (8/team)"))
        .anyMatch(text -> text.contains("up to 16 bots with 0 humans"));
    harness.goLive(op);
    assertThat(harness.snapshot().combatants()).hasSize(16);
    assertThat(harness.snapshot().combatants().stream().filter(c -> c.id().isBot())).hasSize(15);
  }

  @Test
  void teamOverrideFillsTheDeficitAndCannotBeChangedByAnOrdinaryPlayer() {
    var harness = start();
    var op = operator(harness);
    op.performCommand("rwf admin size team 6");
    var alice = harness.loadedPlayer("Alice");
    alice.setOp(false);
    alice.performCommand("rwf admin size small");
    alice.performCommand("rwf size");
    assertThat(RwfHarness.messages(alice))
        .anyMatch(text -> text.contains("team 6, 12 total (6/team)"));
    harness.goLive(alice);
    assertThat(harness.snapshot().combatants()).hasSize(12);
    for (var team : harness.snapshot().teams()) {
      assertThat(
              harness.snapshot().combatants().stream()
                  .filter(c -> c.team().filter(team::equals).isPresent()))
          .hasSize(6);
    }
  }

  @Test
  void changingSizeDuringCountdownAffectsOnlyTheNextDraft() {
    var harness = start();
    var op = operator(harness);
    harness.enter(op);
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    op.performCommand("rwf admin size auto");
    assertThat(RwfHarness.messages(op)).anyMatch(text -> text.contains("target is already 8"));
    harness.tick(Duration.ofSeconds(91));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    assertThat(harness.snapshot().combatants()).hasSize(8);
    op.performCommand("rwf leave");
    harness.ticks(1);
    harness.tick(Duration.ofSeconds(31));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LOBBY);
    harness.goLive(harness.loadedPlayer("Bob"));
    assertThat(harness.snapshot().combatants()).hasSize(16);
  }

  @Test
  void explicitShowcaseCountsKeepTheirOriginalSize() {
    var harness = start();
    var op = operator(harness);
    op.performCommand("rwf admin size large");
    op.performCommand("rwf admin showcase 4");
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.tick(Duration.ofSeconds(91));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    assertThat(harness.snapshot().combatants()).hasSize(4);
  }
}
