package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.SummonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Bots see enemy killstreak creatures as they see players, and know what bit them. */
final class SummonSightTest {

  private static final NavArtifact NAV = SyntheticMap.bake();

  private final Perception perception =
      new Perception(new SenseContext(NAV.grid(), NAV.graph(), NAV.regions(), levers(0.8)));

  /** A red bot at x=10 looking east, towards the wall at x=16. */
  private static final CombatantView SELF =
      combatant(1, RED, new Vec3(10.5, 1, 5.5)).withFacing(new Facing(-90, 0));

  private static SummonView golem(int id, Vec3 pos) {
    return new SummonView(new CombatantId(id), SummonView.Kind.GOLEM, BLUE, pos, Vec3.ZERO, 40);
  }

  private Percept perceive(
      List<CombatantView> views, List<SummonView> summons, List<Stimulus> sounds) {
    var world =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            views,
            List.of(),
            PoisonView.NONE,
            "synthetic",
            sounds,
            List.of(),
            summons);
    return perception.perceive(PerceptionState.EMPTY, SELF, world, new SplittableRandom(1));
  }

  @Test
  void anEnemyGolemInTheOpenIsSeenButNotOneBehindTheWallOrOurOwn() {
    var open = golem(5, new Vec3(14.5, 1, 5.5));
    var walled = golem(6, new Vec3(22.5, 1, 5.5));
    var ours =
        new SummonView(
            new CombatantId(7), SummonView.Kind.WOLF, RED, new Vec3(13.5, 1, 6.5), Vec3.ZERO, 14);
    var percept = perceive(List.of(SELF), List.of(walled, ours, open), List.of());
    assertThat(percept.summons()).containsExactly(open);
  }

  @Test
  void aGolemsBlowNamesTheGolemAndNeverItsOwner() {
    var golem = golem(5, SELF.pos().plus(-2, 0, 0));
    var owner = combatant(2, BLUE, new Vec3(3.5, 1, 25.5));
    var blow = Stimulus.hit(SELF.pos(), 10, golem.id(), SELF.id());
    var percept = perceive(List.of(SELF, owner), List.of(golem), List.of(blow));

    assertThat(percept.state().grudge())
        .hasValueSatisfying(grudge -> assertThat(grudge.attacker()).isEqualTo(golem.id()));
    assertThat(percept.state().memory().of(owner.id()))
        .as("the owner, wherever it stands, stays unknown")
        .isEmpty();
  }
}
