package com.shepherdjerred.thestorm.arena.app;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.app.ArenaHeadlines.Headline;
import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ArenaHeadlinesTest {

  private final ArenaHeadlines headlines = new ArenaHeadlines();
  private final List<Headline> seen = new ArrayList<>();
  private ArenaGame game = ArenaGame.open(Samples.setup());
  private Instant now = T0;

  private void on(GameEvent event) {
    switch (game.on(event)) {
      case Result.Ok<ArenaGame.Step, GameError>(var step) -> {
        var before = game;
        game = step.game();
        seen.addAll(headlines.accept(new ArenaNotification(event, step.effects(), before, game)));
      }
      case Result.Err<ArenaGame.Step, GameError>(var error) ->
          throw new AssertionError(event + " was refused: " + error);
    }
  }

  private void tick(long seconds) {
    now = now.plus(Duration.ofSeconds(seconds));
    on(new GameEvent.Tick(now, 0));
  }

  private void arrive(UUID player, String name) {
    on(new GameEvent.Join(player, name));
    on(new GameEvent.SnapshotStored(player));
    on(new GameEvent.PickClass(player, "knight", true));
    on(new GameEvent.Ready(player));
  }

  /** Starts with Alice alone and plays until the wave 2 boss spawns. */
  private void reachTheFirstBoss() {
    arrive(ALICE, "Alice");
    tick(1);
    tick(10);
    tick(5);
    tick(1);
    tick(5);
  }

  @Test
  void announcesTheFirstPlayerIntoAnEmptyLobbyOnce() {
    arrive(ALICE, "Alice");
    arrive(BOB, "Bob");

    assertThat(seen).containsExactly(new Headline.LobbyOpened("Test Arena", "Alice"));
  }

  @Test
  void announcesRewardingBossWavesAndTheRunsEnd() {
    reachTheFirstBoss();
    on(new GameEvent.Died(ALICE));

    assertThat(seen)
        .containsExactly(
            new Headline.LobbyOpened("Test Arena", "Alice"),
            new Headline.BossWave("Test Arena", 2, "The King"),
            new Headline.RunEnded("test", "Test Arena", "Ominous I", Map.of("Alice", 2)));
  }

  @Test
  void aStoppedRunIsNotAnnouncedAndTheNextRunStartsClean() {
    reachTheFirstBoss();
    on(new GameEvent.Stop());
    seen.clear();

    reachTheFirstBoss();
    on(new GameEvent.Died(ALICE));

    assertThat(seen)
        .last()
        .isEqualTo(new Headline.RunEnded("test", "Test Arena", "Ominous I", Map.of("Alice", 2)));
  }
}
