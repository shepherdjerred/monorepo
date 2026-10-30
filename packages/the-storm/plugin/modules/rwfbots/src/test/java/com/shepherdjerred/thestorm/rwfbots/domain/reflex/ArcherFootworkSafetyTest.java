package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class ArcherFootworkSafetyTest {
  private record Scene(
      VoxelGrid grid, CombatantView self, CombatantView ally, CombatantView target) {}

  /** A sword further off than an archer backs away from ({@link BowSpacing#SWORD_NEAR}). */
  private static Scene scene(boolean ledge, boolean hurt) {
    return scene(ledge, hurt, 14.5);
  }

  private static Scene scene(boolean ledge, boolean hurt, double targetX) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 16, 8, 16);
    var floor = new BitSet(bounds.volume());
    for (var x = 0; x < 16; x++)
      for (var z = ledge ? 5 : 0; z < 16; z++) floor.set(bounds.index(x, 0, z));
    return new Scene(
        new VoxelGrid(bounds, floor, floor, floor),
        combatant(1, RED, new Vec3(5.5, 1, 5.1)).withHealth(1, 0).withLastHurtTick(hurt ? 0 : -1),
        combatant(3, RED, new Vec3(5.5, 1, 6.1)),
        combatant(2, BLUE, new Vec3(targetX, 1, 5.1)));
  }

  private static List<BodyCommand> commands(Scene scene) {
    var self = scene.self();
    var target = scene.target();
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(self, scene.ally(), target),
            List.of(),
            PoisonView.NONE,
            "ledge",
            List.of(),
            List.of(),
            List.of());
    var decision =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(target.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight",
            1,
            0,
            Optional.empty());
    return Reflex.tick(
            ReflexState.initial(self.facing()).withStrafe(1, 100),
            new ReflexInput(self, world, decision, Optional.of(target), 0, List.of()),
            new ReflexContext(scene.grid(), levers(1), Loadout.standard(Kit.LONGBOW)),
            new SplittableRandom(7))
        .commands();
  }

  @Test
  void aDrawingArcherStopsInsteadOfSeparatingOffALedge() {
    var scene = scene(true, false);
    var commands = commands(scene);
    assertThat(commands).contains(new BodyCommand.Stop(), new BodyCommand.StartUse());
    assertThat(commands).noneMatch(BodyCommand.MoveToward.class::isInstance);
  }

  @Test
  void aHurtArcherChoosesSupportedEvasionInsteadOfThePreferredFall() {
    var scene = scene(true, true);
    var commands = commands(scene);
    var move =
        commands.stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    assertThat(move.waypoint()).isEqualTo(new Vec3(4.5, 1, 5.1));
    assertThat(
            CombatFootwork.safe(
                scene.grid(), scene.self(), move.waypoint().minus(scene.self().pos())))
        .isTrue();
    assertThat(commands).contains(new BodyCommand.StartUse());
  }

  @Test
  void aDrawingArcherStillSeparatesInSupportedOpenSpace() {
    var commands = commands(scene(false, false));
    assertThat(commands)
        .contains(
            new BodyCommand.MoveToward(new Vec3(5.5, 1, 4.1), false), new BodyCommand.StartUse());
  }

  @Test
  void anArcherBacksAwayFromASwordInsideItsNearEdgeAsItDraws() {
    var scene = scene(false, false, 11.5);
    var commands = commands(scene);
    var move =
        commands.stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    var step = move.waypoint().minus(scene.self().pos()).horizontal().normalized();
    // The teammate a block beside it pushes it aside as well.
    assertThat(step.x()).as("away from the sword: %s", step).isLessThan(-0.5);
    assertThat(move.sprint()).isFalse();
    assertThat(commands).contains(new BodyCommand.StartUse());
  }
}
