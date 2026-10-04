package com.shepherdjerred.thestorm.rwfbots.domain.world;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;
import org.junit.jupiter.api.Test;

final class CombatantViewTest {

  @Test
  void aSpyAppearsOnTheViewersTeam() {
    var spy = combatant(1, BLUE, Vec3.ZERO).withDisguised(true);
    assertThat(spy.apparentTeam(RED)).isEqualTo(RED);
    assertThat(spy.apparentTeam(BLUE)).isEqualTo(BLUE);
    assertThat(spy.appearsAlliedTo(RED)).isTrue();
    assertThat(combatant(2, BLUE, Vec3.ZERO).appearsAlliedTo(RED)).isFalse();
  }

  @Test
  void snapshotRejectsDuplicateIds() {
    var a = combatant(1, RED, Vec3.ZERO);
    var b = combatant(1, BLUE, Vec3.ZERO);
    assertThatThrownBy(
            () ->
                new WorldSnapshot(
                    0, MatchPhase.LIVE, List.of(a, b), List.of(), PoisonView.NONE, "m", List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsOutOfRangeVitals() {
    assertThatThrownBy(() -> combatant(1, RED, Vec3.ZERO).withHealth(21, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
