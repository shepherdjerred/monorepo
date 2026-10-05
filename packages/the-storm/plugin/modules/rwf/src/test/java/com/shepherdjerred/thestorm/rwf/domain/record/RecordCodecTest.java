package com.shepherdjerred.thestorm.rwf.domain.record;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class RecordCodecTest {

  private static MatchRecord tinyMatch() {
    var header =
        new RecordHeader(
            MatchRecord.SCHEMA_VERSION,
            Samples.MATCH,
            "harbour",
            Samples.SHA,
            Samples.SEED,
            List.of(
                new RosterEntry("p1", TeamColor.RED, "trooper", false),
                new RosterEntry("p2", TeamColor.BLUE, "longbow", true)),
            CombatRules.COMBAT_RULES_VERSION);
    var events =
        List.of(
            new RecordEvent(0, "live", "match", ""),
            new RecordEvent(40, "armed", "blue-1", "p1"),
            new RecordEvent(1240, "exploded", "blue-1", "tab\there\\and\nnewline"),
            new RecordEvent(1240, "died", "p2", "Bomb Exploded"));
    var frames =
        List.of(
            new Frame(
                0,
                "p1",
                Frame.quantizePosition(-29.5),
                Frame.quantizePosition(64),
                16,
                0,
                0,
                80,
                0,
                0),
            new Frame(
                0,
                "p2",
                960,
                2048,
                16,
                Frame.quantizeYaw(-90),
                Frame.quantizePitch(45),
                80,
                1,
                Frame.SPRINTING),
            new Frame(20, "p1", -944, 2048, 16, 128, 0, 72, 0, Frame.SNEAKING | Frame.ON_FIRE));
    var inputs =
        List.of(
            new InputFrame(0, "p1", InputFrame.NONE, 0, 0),
            new InputFrame(
                1,
                "p1",
                InputFrame.FORWARD | InputFrame.SPRINT,
                InputFrame.quantizeYaw(-90.5f),
                InputFrame.quantizePitch(12.25f)),
            new InputFrame(
                2, "p1", InputFrame.LEFT | InputFrame.JUMP | InputFrame.SNEAK, 0, -9000));
    var intents =
        List.of(new Intent(10, "p2", "arm", "red-1"), new Intent(30, "p2", "retreat", ""));
    var end =
        new RecordEnd(
            1240,
            Optional.of(TeamColor.RED),
            RecordEnd.Reason.LAST_TEAM_STANDING,
            Map.of("p1", 3L));
    return new MatchRecord(header, events, frames, inputs, intents, end);
  }

  /**
   * The byte-exact version 2 format. A change here breaks every reader of past recordings: bump
   * {@link MatchRecord#SCHEMA_VERSION} and update this text and the README's format table together.
   */
  @Test
  void theEncodingMatchesTheGoldenText() {
    var golden =
        """
        H\t2\t%s\tharbour\t%s\t%d\t%s
        R\tp1\tRED\ttrooper\tfalse
        R\tp2\tBLUE\tlongbow\ttrue
        E\t0\tlive\tmatch\t
        E\t40\tarmed\tblue-1\tp1
        E\t1240\texploded\tblue-1\ttab\\there\\\\and\\nnewline
        E\t1240\tdied\tp2\tBomb Exploded
        F\t0\tp1\t-944\t2048\t16\t0\t0\t80\t0\t0
        F\t0\tp2\t960\t2048\t16\t192\t32\t80\t1\t2
        F\t20\tp1\t-944\t2048\t16\t128\t0\t72\t0\t5
        N\t0\tp1\t0\t0\t0
        N\t1\tp1\t65\t26950\t1225
        N\t2\tp1\t52\t0\t-9000
        I\t10\tp2\tarm\tred-1
        I\t30\tp2\tretreat\t
        X\t1240\tRED\tLAST_TEAM_STANDING
        P\tp1\t3
        """
            .formatted(Samples.MATCH, Samples.SHA, Samples.SEED, CombatRules.COMBAT_RULES_VERSION);

    assertThat(RecordCodec.encode(tinyMatch())).isEqualTo(golden);
    assertThat(RecordCodec.decode(golden)).isEqualTo(Result.ok(tinyMatch()));
  }

  @Test
  void anOlderFormatIsRefusedRatherThanGuessed() {
    var older = RecordCodec.encode(tinyMatch()).replaceFirst("^H\t2\t", "H\t1\t");

    assertThat(RecordCodec.decode(older).fold(ok -> "", RecordCodec.Problem::message))
        .isEqualTo("record schema 1 is not 2");
  }

  @Test
  void humansAreSampledEveryTickAndBotsEveryOther() {
    assertThat(Frame.due(false, 7)).isTrue();
    assertThat(Frame.due(false, 8)).isTrue();
    assertThat(Frame.due(true, 7)).isFalse();
    assertThat(Frame.due(true, 8)).isTrue();
  }

  @Test
  void inputsKeepExactRotationAndRefuseImpossibleKeys() {
    assertThat(InputFrame.quantizeYaw(-90.5f)).isEqualTo(26_950);
    assertThat(InputFrame.quantizeYaw(360)).isZero();
    assertThat(InputFrame.quantizeYaw(719.5f)).isEqualTo(35_950);
    assertThat(InputFrame.quantizePitch(95)).isEqualTo(9000);
    assertThat(InputFrame.quantizePitch(-12.25f)).isEqualTo(-1225);
    assertThatThrownBy(() -> new InputFrame(0, "p1", 128, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new InputFrame(0, "p1", 0, 36_000, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aRecordSurvivesARoundTrip() {
    var original = tinyMatch();

    var text = RecordCodec.encode(original);
    var decoded = RecordCodec.decode(text);

    assertThat(decoded).isEqualTo(Result.ok(original));
    assertThat(text)
        .startsWith("H\t2\t")
        .contains("\nE\t1240\texploded\tblue-1\ttab\\there\\\\and\\nnewline\n");
  }

  @Test
  void quantisationIsCoarseButReversible() {
    var frame = tinyMatch().frames().getFirst();

    assertThat(frame.position()).isEqualTo(new Vec3(-29.5, 64, 0.5));
    assertThat(Frame.quantizeYaw(-90)).isEqualTo(192);
    assertThat(Frame.quantizeYaw(360)).isZero();
    assertThat(Frame.quantizePitch(45)).isEqualTo(32);
    assertThat(Frame.quantizeHealth(19.9)).isEqualTo(80);
  }

  @Test
  void brokenRecordsNameTheirLine() {
    var decoded = RecordCodec.decode("H\t1\tnot-a-uuid\n");
    assertThat(decoded.isOk()).isFalse();
    int line = decoded.fold(ok -> -1, RecordCodec.Problem::line);
    assertThat(line).isEqualTo(1);

    var noEnd =
        RecordCodec.decode(RecordCodec.encode(tinyMatch()).replaceAll("\nX\t[^\n]*\n", "\n"));
    assertThat(noEnd.fold(ok -> "", RecordCodec.Problem::message)).isEqualTo("no end row");

    var unknownTag = RecordCodec.decode("Z\tanything\n");
    assertThat(unknownTag.fold(ok -> "", RecordCodec.Problem::message)).contains("unknown row tag");
  }

  @Test
  void recordsValidateThemselves() {
    assertThatThrownBy(
            () -> new RecordEnd(1, Optional.of(TeamColor.RED), RecordEnd.Reason.DRAW, Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RosterEntry("Alice", TeamColor.RED, "trooper", false))
        .isInstanceOf(IllegalArgumentException.class);
    var header = tinyMatch().header();
    assertThatThrownBy(
            () ->
                new MatchRecord(
                    header,
                    List.of(new RecordEvent(5, "a", "b", ""), new RecordEvent(4, "a", "b", "")),
                    List.of(),
                    List.of(),
                    List.of(),
                    tinyMatch().end()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("events must be in tick order");
  }
}
