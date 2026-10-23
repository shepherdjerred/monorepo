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
                    0,
                    MatchPhase.LIVE,
                    List.of(a, b),
                    List.of(),
                    PoisonView.NONE,
                    "m",
                    List.of(),
                    List.of(), List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void snapshotLookupKeepsItsOwnImmutableOrderAndValues() {
    var first = combatant(7, RED, Vec3.ZERO);
    var second = combatant(2, BLUE, Vec3.ZERO);
    var incoming = new ArrayList<>(List.of(first, second));
    var original =
        new WorldSnapshot(
            0, MatchPhase.LIVE, incoming, List.of(), PoisonView.NONE, "m", List.of(), List.of(), List.of());
    incoming.clear();
    assertThat(original.combatants()).containsExactly(first, second);
    assertThat(original.combatant(first.id())).contains(first);
    assertThat(original.combatant(new CombatantId(99))).isEmpty();
    assertThatThrownBy(() -> original.combatants().set(0, second))
        .isInstanceOf(UnsupportedOperationException.class);
    var changed = first.withHealth(1, 0);
    var next =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(changed),
            List.of(),
            PoisonView.NONE,
            "m",
            List.of(),
            List.of(), List.of());
    assertThat(next.combatant(first.id())).contains(changed);
    assertThat(original.require(first.id())).isEqualTo(first);
    assertThatThrownBy(() -> next.require(second.id()))
        .isInstanceOf(IllegalArgumentException.class);
    var equal =
        new WorldSnapshot(
            0,
            MatchPhase.LIVE,
            List.of(first, second),
            List.of(),
            PoisonView.NONE,
            "m",
            List.of(),
            List.of(), List.of());
    assertThat(original).isEqualTo(equal).hasSameHashCodeAs(equal);
  }

  @Test
  void rejectsOutOfRangeVitals() {
    assertThatThrownBy(() -> combatant(1, RED, Vec3.ZERO).withHealth(21, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> combatant(1, RED, Vec3.ZERO).withHealth(Double.NaN, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> combatant(1, RED, Vec3.ZERO).withHealth(20, Double.POSITIVE_INFINITY))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void snapshotCopiesRetainActualCapabilities() {
    var capabilities = new TraversalState(false, 5, 0.5, 12, 1, 80, 50, -1, 3, 0, 60, 2, 90, 30, 0);
    var body = combatant(1, RED, Vec3.ZERO).withTraversal(capabilities);
    var copies =
        List.of(
            body.withPos(new Vec3(1, 2, 3)),
            body.withVel(new Vec3(0.1, 0, 0)),
            body.withFacing(body.facing()),
            body.withHealth(30, 1),
            body.withAlive(false),
            body.withInvisible(true, 0),
            body.withDisguised(true),
            body.withLastHurtTick(3),
            body.withMotion(true, false),
            body.withHands(2, true));
    assertThat(copies).allSatisfy(copy -> assertThat(copy.traversal()).isSameAs(capabilities));
  }
}
