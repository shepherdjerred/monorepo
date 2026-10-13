package com.shepherdjerred.thestorm.rwf.domain.record;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** A schema 4 recording carries every row kind and reads back, row by row, exactly as written. */
final class MatchReplayTest {

  private static RecordHeader header(int version) {
    return new RecordHeader(
        version,
        Samples.MATCH,
        "harbour",
        Samples.SHA,
        Samples.SEED,
        List.of(
            new RosterEntry("p1", TeamColor.RED, "trooper", false),
            new RosterEntry("p2", TeamColor.BLUE, "longbow", true),
            new RosterEntry("p3", TeamColor.BLUE, "rewind", true)),
        CombatRules.COMBAT_RULES_VERSION);
  }

  @Test
  void sharedOccurrenceFixtureRoundTripsThroughTheJavaCodec() throws IOException {
    String rows;
    try (var stream =
        requireNonNull(getClass().getResourceAsStream("/schema-4-occurrences.json"))) {
      rows =
          String.join("\n", JsonMapper.builder().build().readValue(stream, String[].class)) + "\n";
    }
    var original = fullMatch();
    var empty =
        new MatchRecord(
            original.header(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            original.end());
    var text = RecordCodec.encode(empty);
    var at = text.indexOf("X\t");
    var decoded =
        RecordCodec.decode(text.substring(0, at) + rows + text.substring(at))
            .fold(
                record -> record,
                problem -> {
                  throw new AssertionError(problem.message());
                });

    assertThat(decoded.occurrences()).hasSize(10);
    for (var row : rows.lines().toList()) {
      assertThat(RecordCodec.encode(decoded)).contains(row + "\n");
    }
  }

  private static List<Occurrence> everyOccurrence() {
    return List.of(
        new Occurrence.Ballot(
            0,
            List.of(
                new Occurrence.Ballot.Candidate("harbour", 3),
                new Occurrence.Ballot.Candidate("training-yard", 1),
                new Occurrence.Ballot.Candidate("saigon-two", 0)),
            "harbour"),
        new Occurrence.Pulse(
            0,
            Map.of(TeamColor.RED, 1, TeamColor.BLUE, 2),
            Map.of("red-1", Occurrence.Pulse.BombStatus.IDLE),
            PoisonClock.Stage.WAITING),
        new Occurrence.Chat(3, "p1", "team", 11, Optional.empty()),
        new Occurrence.Chat(4, "p2", "global", 14, Optional.of("gg\tno\\re\nmatch")),
        new Occurrence.Projectile(10, "p2", "arrow", -29.5, 65.62, 0.5, 1.25, -0.0625, 0.0),
        new Occurrence.AbilityUse(12, "p3", "rewind", Optional.empty()),
        new Occurrence.AbilityUse(13, "p3", "teleport", Optional.of("p1")),
        new Occurrence.EffectApplied(14, "p1", "speed", 1, 200),
        new Occurrence.Pulse(
            100,
            Map.of(TeamColor.RED, 1, TeamColor.BLUE, 1),
            Map.of(
                "red-1", Occurrence.Pulse.BombStatus.ARMED,
                "nuke-1", Occurrence.Pulse.BombStatus.DESTROYED),
            PoisonClock.Stage.WARNED),
        new Occurrence.Kill(
            120,
            "p2",
            Optional.of("p1"),
            "Melee",
            Optional.of("iron_sword"),
            OptionalDouble.of(2.75),
            Map.of("p3", 0.25)),
        new Occurrence.Killstreak(120, "p1", "compass", 2),
        new Occurrence.BlockChange(
            1240, 3, 64, -2, "minecraft:coal_block", Occurrence.BlockChange.Reason.CRATER),
        new Occurrence.Kill(
            1240,
            "p3",
            Optional.empty(),
            "Bomb Exploded",
            Optional.empty(),
            OptionalDouble.empty(),
            Map.of()),
        new Occurrence.BlockChange(
            1300,
            3,
            64,
            -2,
            "minecraft:stone_slab[type=top]",
            Occurrence.BlockChange.Reason.REVERT));
  }

  private static MatchRecord fullMatch() {
    var frames = new ArrayList<Frame>();
    for (var tick = 0; tick < 3; tick++) {
      frames.add(new Frame(tick, "p1", -944, 2048, 16, 0, 0, 80, 0, 0));
      frames.add(new Frame(tick, "p2", 960, 2048, 16, 128, 0, 80, 1, Frame.SPRINTING));
      frames.add(new Frame(tick, "p3", 0, 2048, 0, 64, 0, 80, 2, 0));
    }
    return new MatchRecord(
        header(MatchRecord.SCHEMA_VERSION),
        List.of(
            new RecordEvent(0, "joined", "p1", "RED"), new RecordEvent(40, "armed", "red-1", "")),
        frames,
        List.of(
            new InputFrame(
                0, "p1", 65, 26950, -1225, true, false, 0, 7, -1, InputFrame.Source.HUMAN)),
        List.of(new ObservationFrame(0, "p1", "rwf-combat-v1", List.of(0.5, -1.0))),
        List.of(new Intent(10, "p2", "attack", "p1")),
        everyOccurrence(),
        new RecordEnd(
            1240,
            Optional.of(TeamColor.RED),
            RecordEnd.Reason.LAST_TEAM_STANDING,
            Map.of("p1", 3L)));
  }

  @Test
  void aFullMatchWithEveryRowKindReplaysExactly() {
    var original = fullMatch();
    var text = RecordCodec.encode(original);

    var streamed = RecordCodec.read(new BufferedReader(new StringReader(text)));

    assertThat(streamed).isEqualTo(Result.ok(original));
    assertThat(RecordCodec.decode(text)).isEqualTo(Result.ok(original));
    for (var tag : List.of("B", "J", "A", "U", "K", "C", "V", "D", "S")) {
      assertThat(text).as("row %s", tag).containsPattern("(?m)^" + tag + "\t");
    }
  }

  @Test
  void theOccurrenceRowsHaveAFixedShape() {
    var text = RecordCodec.encode(fullMatch());

    assertThat(text)
        .contains("V\t0\tharbour\tharbour\t3\ttraining-yard\t1\tsaigon-two\t0\n")
        .contains("S\t0\tWAITING\tRED=1,BLUE=2\tred-1=IDLE\n")
        .contains("S\t100\tWARNED\tRED=1,BLUE=1\tnuke-1=DESTROYED,red-1=ARMED\n")
        .contains("C\t3\tp1\tteam\t11\t\n")
        .contains("C\t4\tp2\tglobal\t14\tgg\\tno\\\\re\\nmatch\n")
        .contains("J\t10\tp2\tarrow\t-29.5\t65.62\t0.5\t1.25\t-0.0625\t0.0\n")
        .contains("A\t12\tp3\trewind\t\n")
        .contains("A\t13\tp3\tteleport\tp1\n")
        .contains("U\t14\tp1\tspeed\t1\t200\n")
        .contains("D\t120\tp2\tp1\tMelee\tiron_sword\t2.75\tp3=0.25\n")
        .contains("K\t120\tp1\tcompass\t2\n")
        .contains("B\t1240\t3\t64\t-2\tminecraft:coal_block\tCRATER\n")
        .contains("D\t1240\tp3\t-\tBomb Exploded\t-\t-\n");
  }

  @Test
  void aHumansWordsAreNeverRecorded() {
    var record = fullMatch();
    var human =
        new ArrayList<Occurrence>(
            List.of(new Occurrence.Chat(0, "p1", "global", 2, Optional.of("hi"))));

    assertThatThrownBy(
            () ->
                new MatchRecord(
                    record.header(),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    human,
                    record.end()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("bot");
    assertThatThrownBy(() -> new Occurrence.Chat(0, "p2", "global", 3, Optional.of("hi")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void olderSchemasCannotCarryOccurrencesAndStillRead() {
    var record = fullMatch();
    assertThatThrownBy(
            () ->
                new MatchRecord(
                    header(3),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    everyOccurrence(),
                    record.end()))
        .isInstanceOf(IllegalArgumentException.class);

    var schema3 = RecordCodec.encode(record).replaceFirst("^H\t4\t", "H\t3\t");
    assertThat(RecordCodec.decode(schema3).fold(ok -> "", RecordCodec.Problem::message))
        .isEqualTo("occurrence rows require schema 4");

    var withoutOccurrences =
        new MatchRecord(
            header(3),
            record.events(),
            record.frames(),
            record.inputs(),
            record.observations(),
            record.intents(),
            List.of(),
            record.end());
    assertThat(RecordCodec.decode(RecordCodec.encode(withoutOccurrences)))
        .isEqualTo(Result.ok(withoutOccurrences));
    assertThat(RecordCodec.decode("H\t5\t" + Samples.MATCH + "\n").isOk()).isFalse();
  }

  @Test
  void occurrencesValidateThemselves() {
    assertThatThrownBy(
            () ->
                new Occurrence.Kill(
                    1,
                    "p1",
                    Optional.of("p2"),
                    "Melee",
                    Optional.empty(),
                    OptionalDouble.empty(),
                    Map.of("p2", 0.5)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Occurrence.Kill(
                    1,
                    "p1",
                    Optional.empty(),
                    "Melee",
                    Optional.empty(),
                    OptionalDouble.of(-1),
                    Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Occurrence.Kill(
                    1,
                    "p1",
                    Optional.empty(),
                    "Melee",
                    Optional.empty(),
                    OptionalDouble.empty(),
                    Map.of("p3", 1.5)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Occurrence.Ballot(
                    0, List.of(new Occurrence.Ballot.Candidate("harbour", 1)), "saigon"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Occurrence.Pulse(0, Map.of(), Map.of(), PoisonClock.Stage.WAITING))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Occurrence.BlockChange(
                    0, 0, 0, 0, "two words", Occurrence.BlockChange.Reason.CRATER))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Occurrence.Killstreak(0, "p1", "compass", 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Occurrence.Projectile(0, "p1", "arrow", Double.NaN, 0, 0, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(Occurrence.Pulse.due(200)).isTrue();
    assertThat(Occurrence.Pulse.due(201)).isFalse();
  }

  @Test
  void aBrokenOccurrenceNamesItsLine() {
    var text = RecordCodec.encode(fullMatch()).replace("\tp3=0.25\n", "\tp3=lots\n");

    var read = RecordCodec.read(new BufferedReader(new StringReader(text)));

    assertThat(read.isOk()).isFalse();
    var line = read.fold(ok -> -1, RecordCodec.Problem::line);
    assertThat(text.lines().toList().get(line - 1)).startsWith("D\t120\t");
  }
}
