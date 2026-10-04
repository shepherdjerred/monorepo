package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.util.HashSet;
import java.util.List;
import org.junit.jupiter.api.Test;

final class BossMechanicsTest {
  private static final Point ORIGIN = new Point(0, 73, 0);
  private static final Point AIM = new Point(10, 73, 0);

  @Test
  void everyBossAlternatesThreeTelegraphedAttacksWithAnEscape() {
    for (var id :
        List.of(
            "gale-sovereign", "hexmaster", "ravager", "heartwood", "warden", "furnace-colossus")) {
      var boss = new BossMechanics(id, T0);
      var shapes = new HashSet<BossMechanics.Shape>();
      for (var castIndex = 0; castIndex < 3; castIndex++) {
        var now = T0.plusSeconds(5 + castIndex * 20);
        assertThat(boss.begin(now, ORIGIN, AIM, 1)).isTrue();
        var cast = boss.cast().orElseThrow();
        shapes.add(cast.shape());
        assertThat(cast.impact()).isEqualTo(now.plusSeconds(3));
        assertThat(boss.impact(now.plusMillis(2999))).isEmpty();
        var safe = false;
        var dangerous = false;
        for (var x = -12; x <= 24; x++) {
          for (var z = -12; z <= 12; z++) {
            var hits = cast.hits(new Point(x, 73, z));
            dangerous |= hits;
            safe |= !hits;
          }
        }
        assertThat(safe).isTrue();
        assertThat(dangerous).isTrue();
        assertThat(boss.impact(now.plusSeconds(3))).contains(cast);
      }
      assertThat(shapes).hasSize(3);
    }
  }

  @Test
  void burstDamageCannotSkipAnyPhaseIncludingTheFinalAttack() {
    var boss = new BossMechanics("gale-sovereign", T0);
    assertThat(boss.damageLimit(200, 200)).isEqualTo(68);
    assertThat(boss.damageLimit(132, 200)).isZero();
    assertThat(boss.phase(.66)).isEqualTo(1);
    boss.begin(T0.plusSeconds(5), ORIGIN, AIM, .66);
    boss.impact(T0.plusSeconds(8));
    assertThat(boss.phase(.66)).isEqualTo(2);
    assertThat(boss.damageLimit(132, 200)).isEqualTo(66);
    assertThat(boss.damageLimit(66, 200)).isZero();
    boss.begin(T0.plusSeconds(9), ORIGIN, AIM, .33);
    assertThat(boss.cast().orElseThrow().shape()).isEqualTo(BossMechanics.Shape.VORTEX);
    assertThat(boss.phase(.33)).isEqualTo(2);
    boss.impact(T0.plusSeconds(12));
    assertThat(boss.phase(.33)).isEqualTo(3);
    assertThat(boss.damageLimit(66, 200)).isEqualTo(65);
    boss.begin(T0.plusSeconds(13), ORIGIN, AIM, .005);
    assertThat(boss.cast().orElseThrow().shape()).isEqualTo(BossMechanics.Shape.WIND_BARRAGE);
    assertThat(boss.damageLimit(1, 200)).isZero();
    boss.impact(T0.plusSeconds(16));
    assertThat(boss.damageLimit(1, 200)).isEqualTo(1);
  }

  @Test
  void anInterruptedPhaseDoesNotRequireAnUnavoidableHit() {
    var boss = new BossMechanics("hexmaster", T0);
    boss.begin(T0.plusSeconds(5), ORIGIN, AIM, .66);
    assertThat(boss.interrupt(T0.plusSeconds(6))).isTrue();
    assertThat(boss.phase(.66)).isEqualTo(2);
    assertThat(boss.impact(T0.plusSeconds(8))).isEmpty();
  }

  @Test
  void attacksAllowChangesInTerrainAndBossDamageIsBounded() {
    var ring = new BossMechanics.Cast(BossMechanics.Shape.VORTEX, ORIGIN, AIM, T0, 2);
    assertThat(ring.hits(AIM)).isFalse();
    assertThat(ring.hits(new Point(14, 78, 0))).isTrue();
    assertThat(ring.hits(new Point(14, 82, 0))).isFalse();
    assertThat(BossMechanics.damage(5, 1)).isEqualTo(6);
    assertThat(BossMechanics.damage(5, 2)).isEqualTo(8);
    assertThat(BossMechanics.damage(5, 3)).isEqualTo(10);
    assertThat(BossMechanics.damage(500, 3)).isEqualTo(14);
    assertThat(EncounterDirector.bossHealth(500, 4)).isEqualTo(1000);
  }
}
