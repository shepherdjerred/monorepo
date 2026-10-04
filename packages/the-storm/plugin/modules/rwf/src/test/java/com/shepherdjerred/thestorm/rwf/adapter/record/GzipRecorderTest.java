package com.shepherdjerred.thestorm.rwf.adapter.record;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.MatchRecord;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordCodec;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import com.shepherdjerred.thestorm.rwf.domain.record.RosterEntry;
import com.shepherdjerred.thestorm.rwf.testing.FakeClock;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Recordings are written as decodable rows under pseudonyms, and pruned by age and size. */
final class GzipRecorderTest {

  @TempDir Path directory;

  private static String decompress(Path file) {
    try (var in = new GZIPInputStream(Files.newInputStream(file))) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Test
  void aRecordingDecodesWithTheCodecAndNamesNobody() {
    var pseudonyms = new Pseudonyms("test-salt");
    var alice = pseudonyms.of(Samples.ALICE.uuid());
    var bot = pseudonyms.of(Samples.BOT_1.uuid());
    var recorder =
        new GzipRecorder(directory, "rwf-recordings", new DirectComputePool(), new FakeClock(T0));
    var header =
        new RecordHeader(
            MatchRecord.SCHEMA_VERSION,
            Samples.MATCH,
            "training-yard",
            Samples.SHA,
            Samples.SEED,
            List.of(
                new RosterEntry(alice, TeamColor.RED, "trooper", false),
                new RosterEntry(bot, TeamColor.BLUE, "longbow", true)),
            CombatRules.COMBAT_RULES_VERSION);

    var recording = recorder.begin(header);
    recording.event(new RecordEvent(0, "joined", alice, ""));
    recording.frame(new Frame(1, alice, 32, 2080, 32, 0, 0, 80, 1, 0));
    recording.frame(new Frame(2, bot, 64, 2080, 64, 128, 0, 80, 1, Frame.SPRINTING));
    recording.event(new RecordEvent(3, "died", bot, alice + " Melee"));
    var summary =
        recording
            .end(
                new RecordEnd(
                    4,
                    Optional.of(TeamColor.RED),
                    RecordEnd.Reason.LAST_TEAM_STANDING,
                    Map.of(alice, 3L)))
            .join();

    var file = directory.resolve(summary.file().orElseThrow());
    assertThat(file.toString())
        .contains("rwf-recordings/2026/10/03/" + Samples.MATCH + ".rwfrec.gz");
    assertThat(summary.bytes()).isEqualTo(size(file));
    assertThat(summary.droppedFrames()).isZero();
    var text = decompress(file);
    assertThat(text).doesNotContain(Samples.ALICE.uuid().toString()).doesNotContain("Alice");
    var decoded = RecordCodec.decode(text);
    assertThat(decoded).isInstanceOf(Result.Ok.class);
    var record = ((Result.Ok<MatchRecord, RecordCodec.Problem>) decoded).value();
    assertThat(record.header().roster()).hasSize(2);
    assertThat(record.events()).hasSize(2);
    assertThat(record.frames()).hasSize(2);
    assertThat(record.end().payouts()).containsEntry(alice, 3L);
    assertThat(recorder.close(Duration.ofSeconds(1)).isDone()).isTrue();
  }

  @Test
  void pseudonymsAreStableForASaltAndDifferBetweenSalts() {
    var a = new Pseudonyms("one");
    var b = new Pseudonyms("two");

    assertThat(a.of(Samples.ALICE.uuid())).isEqualTo(a.of(Samples.ALICE.uuid()));
    assertThat(a.of(Samples.ALICE.uuid())).isNotEqualTo(a.of(Samples.BOB.uuid()));
    assertThat(a.of(Samples.ALICE.uuid())).isNotEqualTo(b.of(Samples.ALICE.uuid()));
    assertThat(a.of(Samples.ALICE.uuid())).matches("p[0-9a-f]{16}");
  }

  @Test
  void retentionDeletesOldThenOversizedRecordings() throws IOException {
    var root = directory.resolve("rwf-recordings");
    var old = write(root.resolve("2026/09/01/a.rwfrec.gz"), 100, T0.minus(Duration.ofDays(40)));
    var big = write(root.resolve("2026/10/01/b.rwfrec.gz"), 300, T0.minus(Duration.ofDays(2)));
    var recent = write(root.resolve("2026/10/03/c.rwfrec.gz"), 100, T0.minus(Duration.ofHours(1)));
    write(root.resolve("2026/10/03/notes.txt"), 10, T0);

    var report = Retention.prune(root, Duration.ofDays(30), 250, T0);

    assertThat(report.deleted()).isEqualTo(2);
    assertThat(report.kept()).isEqualTo(1);
    assertThat(Files.exists(old)).isFalse();
    assertThat(Files.exists(big)).isFalse();
    assertThat(Files.exists(recent)).isTrue();
    assertThat(Retention.list(root)).containsExactly(recent);
  }

  private static Path write(Path file, int bytes, Instant modified) throws IOException {
    Files.createDirectories(file.getParent());
    Files.write(file, new byte[bytes]);
    Files.setLastModifiedTime(file, FileTime.from(modified));
    return file;
  }

  private static long size(Path file) {
    try {
      return Files.size(file);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
