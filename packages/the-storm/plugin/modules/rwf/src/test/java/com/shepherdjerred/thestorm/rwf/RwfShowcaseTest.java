package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.adapter.record.Retention;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwf.domain.record.MatchRecord;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordCodec;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import org.bukkit.GameMode;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Bot showcases on MockBukkit: {@code /rwf admin showcase} needs the bot roster and a lobby without
 * humans, fills it with bots alone, plays a whole match without the humans rule, pays nobody,
 * records it, refuses humans who try to join and reopens a normal lobby afterwards.
 */
final class RwfShowcaseTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness harness() {
    return requireNonNull(running);
  }

  private PlayerMock operator() {
    var op = harness().server.addPlayer("Operator");
    op.setOp(true);
    return op;
  }

  /** Runs {@code command} as {@code player} until a message containing {@code text} arrives. */
  private List<String> answer(PlayerMock player, String command, String text) {
    RwfHarness.messages(player);
    player.performCommand(command);
    var seen = new ArrayList<String>();
    harness()
        .until(
            () -> {
              seen.addAll(RwfHarness.messages(player));
              return seen.stream().anyMatch(m -> m.contains(text));
            });
    return seen;
  }

  @Test
  void aShowcaseIsRefusedWithoutTheBotRoster() {
    running = RwfHarness.prepare(directory).enable(directory, false, Map.of());

    assertThat(answer(operator(), "rwf admin showcase", "No bot roster")).isNotEmpty();
    assertThat(harness().snapshot().combatants()).isEmpty();
  }

  @Test
  void aShowcaseIsRefusedWhileHumansPlay() {
    running = RwfHarness.start(directory);
    var alice = harness().loadedPlayer("Alice");
    harness().goLive(alice);

    assertThat(answer(operator(), "rwf admin showcase 4", "Players are in the match")).isNotEmpty();
    assertThat(harness().snapshot().combatants()).hasSize(8);
  }

  @Test
  void aShowcasePlaysToAnEndWithoutHumansPaysNobodyAndTheLobbyReopens() {
    running = RwfHarness.start(directory);
    var harness = harness();
    var op = operator();
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");

    assertThat(answer(op, "rwf admin showcase 4", "Showcase of 4")).isNotEmpty();
    assertThat(harness.snapshot().combatants()).hasSize(4).allMatch(c -> c.id().isBot());
    var matchId = harness.snapshot().matchId();
    assertThat(answer(alice, "rwf join", "bot showcase")).isNotEmpty();
    assertThat(harness.inMatch(alice)).isFalse();
    bob.performCommand("rwf spectate");
    harness.until(() -> bob.getGameMode() == GameMode.SPECTATOR);

    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    assertThat(harness.bots.spawned()).as("the countdown fills to the showcase size").hasSize(4);
    harness.tick(Duration.ofSeconds(91));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    // No humans, by design: the no-humans abort never fires.
    harness.ticks(1);
    harness.tick(Duration.ofSeconds(31));
    harness.tick(Duration.ofSeconds(31));
    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    assertThat(answer(alice, "rwf join", "bot showcase")).isNotEmpty();
    assertThat(op.performCommand("rwf admin showcase")).isTrue();
    assertThat(RwfHarness.messages(op)).anyMatch(m -> m.contains("already running"));

    var loser = harness.snapshot().combatants().getFirst().team().orElseThrow();
    for (var bot : harness.bots.spawned()) {
      var view = harness.snapshot().combatant(harness.bots.idOf(bot).orElseThrow()).orElseThrow();
      if (view.team().filter(loser::equals).isPresent()) {
        bot.setHealth(0);
      }
    }
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.ENDED);

    assertThat(harness.snapshot().outcome()).contains(new Outcome.Winner(winnerAgainst(loser)));
    var store = new JooqMatchStore(harness.database);
    assertThat(store.players(matchId).join()).isEmpty();
    assertThat(store.unpaid().join()).isEmpty();
    assertThat(harness.wallets.receipts()).isEmpty();

    harness.tick(Duration.ofSeconds(16));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LOBBY);

    var record = recording();
    assertThat(record.header().matchId()).isEqualTo(matchId);
    assertThat(record.header().roster()).hasSize(4).allMatch(entry -> entry.bot());
    assertThat(record.end().reason()).isEqualTo(RecordEnd.Reason.LAST_TEAM_STANDING);
    assertThat(record.end().payouts()).isEmpty();
    assertThat(harness.bots.spawned()).isEmpty();
    assertThat(bob.getGameMode()).as("the watcher stays").isEqualTo(GameMode.SPECTATOR);
    assertThat(bob.getWorld()).isEqualTo(harness.rwf);
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    assertThat(harness.bots.spawned()).as("a normal match fills to its target").hasSize(7);
  }

  private static TeamColor winnerAgainst(TeamColor loser) {
    return loser == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
  }

  private MatchRecord recording() {
    var files = new ArrayList<Path>();
    harness()
        .until(
            () -> {
              files.clear();
              files.addAll(Retention.list(directory.resolve("rwf-recordings")));
              return !files.isEmpty();
            });
    try (var in = new GZIPInputStream(Files.newInputStream(files.getFirst()))) {
      var text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      return switch (RecordCodec.decode(text)) {
        case Result.Ok<MatchRecord, RecordCodec.Problem>(var value) -> value;
        case Result.Err<MatchRecord, RecordCodec.Problem>(var problem) ->
            throw new AssertionError(problem);
      };
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
