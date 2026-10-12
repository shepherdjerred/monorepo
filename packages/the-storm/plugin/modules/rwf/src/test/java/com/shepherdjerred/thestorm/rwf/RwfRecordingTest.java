package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.adapter.record.Retention;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.MatchRecord;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordCodec;
import com.shepherdjerred.thestorm.rwf.domain.record.RosterEntry;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Collectors;
import java.util.zip.GZIPInputStream;
import org.bukkit.Input;
import org.bukkit.event.player.PlayerInputEvent;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * What a live match records per tick: a frame for every human each tick and for every bot every
 * other tick, and for humans only an input row with the keys Paper last reported and their exact
 * rotation.
 */
final class RwfRecordingTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  /** The keys a client reports. */
  private record Pressed(boolean forward, boolean sprint) implements Input {

    @Override
    public boolean isForward() {
      return forward;
    }

    @Override
    public boolean isBackward() {
      return false;
    }

    @Override
    public boolean isLeft() {
      return false;
    }

    @Override
    public boolean isRight() {
      return false;
    }

    @Override
    public boolean isJump() {
      return false;
    }

    @Override
    public boolean isSneak() {
      return false;
    }

    @Override
    public boolean isSprint() {
      return sprint;
    }
  }

  @Test
  void humansAreSampledWithTheirKeysEveryTickAndBotsEveryOtherTick() {
    running = RwfHarness.start(directory);
    var harness = requireNonNull(running);
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);
    var events = harness.server.getPluginManager();

    events.callEvent(new PlayerInputEvent(alice, new Pressed(true, true)));
    harness.ticks(20);
    events.callEvent(new PlayerInputEvent(alice, new Pressed(false, false)));
    harness.ticks(4);

    var aliceTeam = harness.combatant(alice).team().orElseThrow();
    for (var bot : harness.bots.spawned()) {
      var view = harness.snapshot().combatant(harness.bots.idOf(bot).orElseThrow()).orElseThrow();
      if (view.team().filter(aliceTeam::equals).isEmpty()) {
        bot.setHealth(0);
      }
    }
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.ENDED);
    var record = recording();

    var pseudonym = new Pseudonyms(RwfHarness.SALT).of(alice.getUniqueId());
    assertThat(record.inputs()).isNotEmpty().allMatch(input -> input.pseudonym().equals(pseudonym));
    var held =
        record.inputs().stream()
            .filter(input -> input.keys() == (InputFrame.FORWARD | InputFrame.SPRINT))
            .map(InputFrame::tick)
            .toList();
    assertThat(held).as("one input row per tick while the keys were held").hasSize(20);
    var first = held.getFirst();
    var last = held.getLast();
    assertThat(last - first).isEqualTo(19);
    assertThat(record.inputs())
        .filteredOn(input -> input.tick() > last)
        .isNotEmpty()
        .allMatch(input -> input.keys() == InputFrame.NONE);

    var window =
        record.frames().stream()
            .filter(frame -> frame.tick() >= first && frame.tick() <= last)
            .collect(Collectors.groupingBy(Frame::pseudonym, Collectors.counting()));
    var bots =
        record.header().roster().stream()
            .filter(RosterEntry::bot)
            .map(RosterEntry::pseudonym)
            .collect(Collectors.toUnmodifiableSet());
    assertThat(window).containsEntry(pseudonym, 20L);
    assertThat(window.keySet()).containsAll(bots);
    assertThat(bots).allSatisfy(bot -> assertThat(window).containsEntry(bot, 10L));
    assertThat(bots).doesNotContain(pseudonym);
  }

  /** The one recording, which the direct compute pool has finished by the time the match ends. */
  private MatchRecord recording() {
    var files = Retention.list(directory.resolve("rwf-recordings"));
    assertThat(files).hasSize(1);
    return switch (RecordCodec.decode(decompress(files.getFirst()))) {
      case Result.Ok<MatchRecord, RecordCodec.Problem>(var value) -> value;
      case Result.Err<MatchRecord, RecordCodec.Problem>(var problem) ->
          throw new AssertionError(problem);
    };
  }

  private static String decompress(Path file) {
    try (var in = new GZIPInputStream(Files.newInputStream(file))) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
