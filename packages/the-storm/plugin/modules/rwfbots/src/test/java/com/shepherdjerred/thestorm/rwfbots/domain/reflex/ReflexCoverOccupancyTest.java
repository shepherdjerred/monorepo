package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class ReflexCoverOccupancyTest {
  private static final Vec3 POSITION = new Vec3(5.5, 1, 5.5);
  private static final ReflexContext CONTEXT =
      new ReflexContext(SyntheticMap.bake().grid(), levers(1), Loadout.standard(Kit.LONGBOW));

  @Test
  void acceptedCoverSpacingDoesNotPushASettledHolderOrArcherOutOfItsCover() {
    var self = combatant(1, RED, POSITION);
    var ally = combatant(2, RED, POSITION.plus(3.5, 0, 0));
    var enemy = combatant(3, BLUE, POSITION.plus(20, 0, 0));
    for (var option : List.of(Option.TAKE_SLOT, Option.HOLD_SLOT)) {
      for (var target : List.of(Optional.<CombatantView>empty(), Optional.of(enemy))) {
        var step = tick(new Scene(self, List.of(self, ally, enemy), target), hold(self, option));
        assertThat(step.commands()).contains(new BodyCommand.Stop());
        assertThat(step.commands()).noneMatch(BodyCommand.MoveToward.class::isInstance);
        if (target.isPresent()) assertThat(step.commands()).contains(new BodyCommand.StartUse());
      }
    }
  }

  @Test
  void genuinelyCrowdedHoldersStillMakeRoomWithinTheTacticalAcceptanceSpacing() {
    var self = combatant(1, RED, POSITION);
    var ally = combatant(2, RED, POSITION.plus(2, 0, 0));
    for (var option : List.of(Option.TAKE_SLOT, Option.HOLD_SLOT)) {
      var step = tick(new Scene(self, List.of(self, ally), Optional.empty()), hold(self, option));
      assertThat(step.commands())
          .contains(new BodyCommand.MoveToward(POSITION.plus(-1, 0, 0), false));
      assertThat(step.commands()).doesNotContain(new BodyCommand.Stop());
    }
  }

  @Test
  void movingSlotActorsRetainFullWalkingSeparation() {
    var self = combatant(1, RED, POSITION);
    var ally = combatant(2, RED, POSITION.plus(0, 0, 3.5));
    var decision =
        hold(self, Option.TAKE_SLOT)
            .withWaypoints(List.of(new Waypoint(POSITION.plus(6, 0, 0), Hop.WALK)));
    var step = tick(new Scene(self, List.of(self, ally), Optional.empty()), decision);
    var moves =
        step.commands().stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .toList();
    assertThat(moves)
        .singleElement()
        .satisfies(
            move -> {
              assertThat(move.waypoint().x()).isGreaterThan(POSITION.x());
              assertThat(move.waypoint().z()).isLessThan(POSITION.z());
            });
  }

  private record Scene(
      CombatantView self, List<CombatantView> fighters, Optional<CombatantView> target) {}

  private static Reflex.Step tick(Scene scene, Decision decision) {
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            scene.fighters(),
            List.of(),
            PoisonView.NONE,
            "cover-occupancy",
            List.of(),
            List.of(),
            List.of());
    return Reflex.tick(
        ReflexState.initial(scene.self().facing()),
        new ReflexInput(scene.self(), world, decision, scene.target(), 0, List.of()),
        CONTEXT,
        new SplittableRandom(4));
  }

  private static Decision hold(CombatantView self, Option option) {
    return new Decision(
        self.id(),
        option,
        Optional.empty(),
        List.of(),
        Stance.CAUTIOUS,
        Optional.empty(),
        Optional.of(POSITION.plus(20, 0, 0)),
        Optional.empty(),
        "cover occupancy",
        1,
        0,
        Optional.empty());
  }
}
