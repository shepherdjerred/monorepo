package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A pearl from a supply crate is saved for a clear gap in the route. */
final class CratePearlTest {
  private static final Vec3 AT = new Vec3(9.5, 1, 24.5);

  @Test
  void aClearGapAheadIsOpenAndAnEnemyInSwordRangeClosesIt() {
    var self = combatant(1, RED, AT);
    var ahead = new Waypoint(AT.plus(12, 0, 0), Hop.WALK);
    assertThat(CratePearl.gapOpen(input(self, List.of(), ahead), 0)).isTrue();
    var enemy = combatant(2, BLUE, AT.plus(3, 0, 0));
    assertThat(CratePearl.gapOpen(input(self, List.of(enemy), ahead), 0)).isFalse();
  }

  private static ReflexInput input(CombatantView self, List<CombatantView> visible, Waypoint ahead) {
    var views = new java.util.ArrayList<CombatantView>();
    views.add(self);
    views.addAll(visible);
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            views,
            List.of(),
            PoisonView.NONE,
            "yard",
            List.of(),
            List.of(),
            List.of());
    var decision = Decision.idle(self.id(), 100, 0).withWaypoints(List.of(ahead));
    return ReflexInput.of(self, snapshot, decision, new Percept(PerceptionState.EMPTY, visible, 100));
  }
}
