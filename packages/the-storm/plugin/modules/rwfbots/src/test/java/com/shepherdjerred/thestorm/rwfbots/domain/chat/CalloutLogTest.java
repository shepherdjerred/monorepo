package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Callout;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** A call a teammate just made about the same place is not made again. */
final class CalloutLogTest {

  private static Callout call(Callout.Kind kind, TeamId team, Vec3 pos, String place) {
    return new Callout(
        kind, new CombatantId(1), team, pos, place, Optional.empty(), Optional.empty(), 0);
  }

  private static Callout enemy(Vec3 pos, String place) {
    return call(Callout.Kind.ENEMY, RED, pos, place);
  }

  /** A sighting called to human {@code human}. */
  private static Callout toHuman(Vec3 pos, String place, int human) {
    return new Callout(
        Callout.Kind.ENEMY,
        new CombatantId(2),
        RED,
        pos,
        place,
        Optional.of(new CombatantId(human)),
        Optional.of("behind you"),
        0);
  }

  @Test
  void anEnemyCallNearATeammatesRecentOneIsARepeat() {
    var log = new CalloutLog();
    var at = Instant.EPOCH;
    log.said(enemy(new Vec3(10, 65, 10), "west mid"), at);
    assertThat(log.repeats(enemy(new Vec3(20, 65, 18), "red side"), at.plusSeconds(3)))
        .as("within 16 blocks")
        .isTrue();
    assertThat(log.repeats(enemy(new Vec3(60, 65, 60), "west mid"), at.plusSeconds(3)))
        .as("the same named place")
        .isTrue();
    assertThat(log.repeats(enemy(new Vec3(40, 65, 40), "blue side"), at.plusSeconds(3)))
        .as("somewhere else")
        .isFalse();
    assertThat(
            log.repeats(enemy(new Vec3(10, 65, 10), "west mid"), at.plus(CalloutLog.ENEMY_WINDOW)))
        .as("once the window has passed")
        .isFalse();
    assertThat(
            log.repeats(
                call(Callout.Kind.ENEMY, BLUE, new Vec3(10, 65, 10), "west mid"),
                at.plusSeconds(1)))
        .as("the other team's chat")
        .isFalse();
  }

  @Test
  void aCallToAHumanIsNotCoveredByOneToNobody() {
    var log = new CalloutLog();
    var at = Instant.EPOCH;
    log.said(enemy(new Vec3(10, 65, 10), "west mid"), at);
    var toHuman = toHuman(new Vec3(12, 65, 10), "west mid", 50);
    assertThat(log.repeats(toHuman, at.plusSeconds(1))).isFalse();
    log.said(toHuman, at.plusSeconds(1));
    assertThat(log.repeats(toHuman, at.plusSeconds(2))).isTrue();
    assertThat(log.repeats(enemy(new Vec3(12, 65, 10), "west mid"), at.plusSeconds(2))).isTrue();
  }

  @Test
  void objectiveCallsCoverTheirMomentLongerAndOnlyTheirKind() {
    var log = new CalloutLog();
    var at = Instant.EPOCH;
    var fuse = new Vec3(8, 65, 31);
    log.said(call(Callout.Kind.RETAKING, RED, fuse, "red bomb"), at);
    var again = call(Callout.Kind.RETAKING, RED, fuse, "red bomb");
    assertThat(log.repeats(again, at.plusSeconds(15))).isTrue();
    assertThat(log.repeats(again, at.plus(CalloutLog.OBJECTIVE_WINDOW))).isFalse();
    assertThat(log.repeats(call(Callout.Kind.DEFUSING, RED, fuse, "red bomb"), at.plusSeconds(1)))
        .isFalse();
  }
}
