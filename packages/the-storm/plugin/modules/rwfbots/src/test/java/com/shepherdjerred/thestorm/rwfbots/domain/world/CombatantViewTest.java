package com.shepherdjerred.thestorm.rwfbots.domain.world;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.ArrayList;
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
  void snapshotLookupKeepsItsOwnImmutableOrderAndValues() {
    var first = combatant(7, RED, Vec3.ZERO);
    var second = combatant(2, BLUE, Vec3.ZERO);
    var incoming = new ArrayList<>(List.of(first, second));
    var original =
        new WorldSnapshot(0, MatchPhase.LIVE, incoming, List.of(), PoisonView.NONE, "m", List.of());
    incoming.clear();
    assertThat(original.combatants()).containsExactly(first, second);
    assertThat(original.combatant(first.id())).contains(first);
    assertThat(original.combatant(new CombatantId(99))).isEmpty();
    assertThatThrownBy(() -> original.combatants().set(0, second))
        .isInstanceOf(UnsupportedOperationException.class);
    var changed = first.withHealth(1, 0);
    var next =
        new WorldSnapshot(
            1, MatchPhase.LIVE, List.of(changed), List.of(), PoisonView.NONE, "m", List.of());
    assertThat(next.combatant(first.id())).contains(changed);
    assertThat(original.require(first.id())).isEqualTo(first);
    assertThatThrownBy(() -> next.require(second.id()))
        .isInstanceOf(IllegalArgumentException.class);
    var equal =
        new WorldSnapshot(
            0, MatchPhase.LIVE, List.of(first, second), List.of(), PoisonView.NONE, "m", List.of());
    assertThat(original).isEqualTo(equal).hasSameHashCodeAs(equal);
  }

  @Test
  void rejectsOutOfRangeVitals() {
    assertThatThrownBy(() -> combatant(1, RED, Vec3.ZERO).withHealth(21, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
