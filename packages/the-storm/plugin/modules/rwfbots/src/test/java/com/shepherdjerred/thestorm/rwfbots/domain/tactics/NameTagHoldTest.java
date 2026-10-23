package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.SenseContext;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** A holder watches an enemy it knows only by its name tag through a wall, and does not shoot. */
final class NameTagHoldTest {
  private static final NavArtifact NAV = SyntheticMap.bake();

  @Test
  void anArcherHoldingItsSlotWatchesANameTagBehindTheWallButHoldsFire() {
    var self = combatant(1, RED, new Vec3(10.5, 1, 5.5)).withFacing(new Facing(-90, 0));
    var enemy = combatant(2, BLUE, new Vec3(22.5, 1, 5.5));
    var mate = combatant(3, RED, new Vec3(3.5, 1, 28.5));
    var world =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            List.of(self, enemy, mate),
            List.of(),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    var context =
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.LONGBOW,
            Archetype.TACTICIAN,
            Set.of(),
            7,
            null);
    var percept =
        new Perception(new SenseContext(NAV.grid(), NAV.graph(), NAV.regions(), levers(1)))
            .perceive(PerceptionState.EMPTY, self, world, new SplittableRandom(1));
    assertThat(percept.visible()).isEmpty();

    var slot =
        new Slot(
            "anchor-0",
            SlotKind.ANCHOR,
            Role.DEFEND,
            self.pos(),
            self.pos().plus(0, 0, 10),
            -1,
            -1,
            Optional.empty(),
            0);
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .withPlan(
                new TeamPlan(
                    Optional.of(Strategy.RUSH),
                    Optional.empty(),
                    Optional.empty(),
                    List.of(),
                    0.5,
                    List.of(slot),
                    Map.of(self.id(), slot.key()),
                    0,
                    Map.of()),
                0);
    var thought =
        Tactics.think(
            TacticsState.fresh(0),
            new Situation(self, world, percept, board, Role.DEFEND),
            context,
            new SplittableRandom(3));

    assertThat(thought.trace().choice()).isNotEqualTo(Option.ENGAGE);
    assertThat(thought.decision().target()).isEmpty();
    assertThat(thought.decision().watch()).hasValue(enemy.pos());
    assertThat(ReflexInput.resolveTarget(self, thought.decision(), percept))
        .as("nothing to shoot at: the tag is no line of sight")
        .isEmpty();
  }
}
