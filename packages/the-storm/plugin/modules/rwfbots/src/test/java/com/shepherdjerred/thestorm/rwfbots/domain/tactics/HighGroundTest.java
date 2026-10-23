package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;

/** Archers take height over what they watch and run up a ladder from a sword; swords do not. */
final class HighGroundTest {

  /**
   * A stone floor, a two-high pillar at (22, 9) giving level cover from the west, and a three-high
   * platform over x 22..31, z 15..19 with a two-high parapet at (22, 4, 16) giving the same cover
   * three blocks up, reached by two one-block steps at x 28, z 13 and 14.
   */
  private static final NavArtifact BALCONY =
      bake(
          (x, y, z) ->
              (x == 22 && z == 9 && y <= 2)
                  || (x >= 22 && z >= 15 && z <= 19 && y <= 3)
                  || (x == 22 && z == 16 && y <= 5)
                  || (x == 28 && z == 13 && y <= 1)
                  || (x == 28 && z == 14 && y <= 2),
          (x, y, z) -> false);

  /**
   * A stone floor and a four-high tower over x 20..23, z 10..13 with a ladder up its west face at
   * (19, 11), the only way up.
   */
  private static final NavArtifact TOWER =
      bake(
          (x, y, z) -> x >= 20 && x <= 23 && z >= 10 && z <= 13 && y <= 4,
          (x, y, z) -> x == 19 && z == 11 && y >= 1 && y <= 4);

  /** Which cells are solid or a ladder, above the floor. */
  private interface Cells {
    boolean at(int x, int y, int z);
  }

  private static NavArtifact bake(Cells solid, Cells ladder) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 32, 10, 24);
    var blocks =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return bounds;
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            if (y == 0 || solid.at(x, y, z)) return BlockShape.FULL;
            return ladder.at(x, y, z) ? BlockShape.LADDER : BlockShape.PASSABLE;
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksMovement();
          }
        };
    var sites =
        new NavSites(
            List.of(
                new NavSites.Site("red-spawn", Optional.of("red"), new BlockPos(2, 1, 2)),
                new NavSites.Site("blue-spawn", Optional.of("blue"), new BlockPos(2, 1, 21))),
            List.of());
    return MapBaker.bake("high-ground", blocks, sites);
  }

  private static TacticsContext context(NavArtifact nav, Kit kit) {
    return new TacticsContext(
        nav,
        levers(0.8),
        new Style(0.5, 0.5, 0.5, 0.5),
        kit,
        Archetype.TACTICIAN,
        Set.of(),
        42,
        null);
  }

  private static Situation situation(CombatantView self, CombatantView enemy, Blackboard board) {
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            "high-ground",
            List.of(),
            List.of(), List.of());
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, List.of(enemy), 100),
        board,
        Role.ROTATE);
  }

  /** A bot holding a slot at (24.5, 12.5) that watches an enemy twenty blocks west of it. */
  private static Plan holdSlot(Kit kit) {
    var self = combatant(1, RED, new Vec3(24.5, 1, 4.5));
    var enemy = combatant(2, BLUE, new Vec3(4.5, 1, 12.5));
    var slot =
        new Slot(
            "hold-0",
            SlotKind.FLANK,
            Role.ROTATE,
            new Vec3(24.5, 1, 12.5),
            enemy.pos(),
            -1,
            -1,
            Optional.empty(),
            0);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.SPLIT),
            Optional.of(new Vec3(2.5, 1, 22.5)),
            Optional.empty(),
            List.of(),
            0.5,
            List.of(slot),
            Map.of(self.id(), slot.key()),
            100,
            Map.of());
    var board = Blackboard.open(RED, Strategy.SPLIT).withPlan(plan, 100);
    return Planner.expand(Option.HOLD_SLOT, situation(self, enemy, board), context(BALCONY, kit));
  }

  private static Vec3 coverOf(Plan plan) {
    assertThat(plan.current()).isInstanceOf(PlanStep.Cover.class);
    return ((PlanStep.Cover) plan.current()).pos();
  }

  @Test
  void anArcherHoldsTheParapetAboveTheEnemyOverLevelCoverJustAsNear() {
    var level = new Vec3(23.5, 1, 9.5);
    var parapet = new Vec3(23.5, 4, 16.5);
    var goal = new Vec3(24.5, 1, 12.5);
    // The level spot is nearer; the parapet's three blocks of height outweigh the difference.
    assertThat(level.distance(goal)).isLessThan(parapet.distance(goal));
    assertThat(parapet.distance(goal) - RangedPosition.heightAdvantage(3))
        .isLessThan(level.distance(goal));
    assertThat(coverOf(holdSlot(Kit.LONGBOW))).isEqualTo(parapet);
  }

  @Test
  void aSwordTakesTheNearestCoverWhateverItsHeight() {
    assertThat(coverOf(holdSlot(Kit.TROOPER))).isEqualTo(new Vec3(23.5, 1, 9.5));
  }

  @Test
  void heightIsWorthOneBlockOfTravelPerBlockUpToTheCap() {
    assertThat(RangedPosition.heightAdvantage(-2)).isZero();
    assertThat(RangedPosition.heightAdvantage(3)).isEqualTo(3 * RangedPosition.HEIGHT_WORTH);
    assertThat(RangedPosition.heightAdvantage(9))
        .isEqualTo(RangedPosition.HEIGHT_CAP * RangedPosition.HEIGHT_WORTH);
  }

  /** A bot at (16.5, 11.5), three blocks from the tower's ladder, retreating from a sword. */
  private static Plan retreat(Kit kit, Vec3 chaser) {
    var self = combatant(1, RED, new Vec3(16.5, 1, 11.5)).withHealth(3, 0);
    var enemy = combatant(2, BLUE, chaser);
    var board = Blackboard.open(RED, Strategy.SPLIT);
    return Planner.expand(Option.RETREAT, situation(self, enemy, board), context(TOWER, kit));
  }

  private static Vec3 fleeGoal(Plan plan) {
    assertThat(plan.current()).isInstanceOf(PlanStep.Flee.class);
    return ((PlanStep.Flee) plan.current()).goal();
  }

  @Test
  void aChasedArcherRunsUpTheLadderTheSwordMustClimbAfterIt() {
    var goal = fleeGoal(retreat(Kit.LONGBOW, new Vec3(8.5, 1, 11.5)));
    assertThat(goal.y()).isEqualTo(5);
    assertThat(TOWER.graph().nodeAt(BlockPos.of(goal))).isPresent();
  }

  @Test
  void theArchersEscapeRouteClimbsTheLadder() {
    var self = combatant(1, RED, new Vec3(16.5, 1, 11.5)).withHealth(3, 0);
    var enemy = combatant(2, BLUE, new Vec3(8.5, 1, 11.5));
    var situation = situation(self, enemy, Blackboard.open(RED, Strategy.SPLIT));
    var context = context(TOWER, Kit.LONGBOW);
    var plan = Planner.expand(Option.RETREAT, situation, context);
    var decision = Planner.decide(plan, situation, context, 0);
    Predicate<Waypoint> climbing = point -> point.hop() == Hop.CLIMB;
    assertThat(decision.waypoints()).anyMatch(climbing);
    assertThat(decision.waypoints().getLast().pos().y()).isEqualTo(5);
  }

  @Test
  void aChasedSwordRetreatsAlongTheGround() {
    assertThat(fleeGoal(retreat(Kit.TROOPER, new Vec3(8.5, 1, 11.5))).y()).isEqualTo(1);
  }

  @Test
  void anArcherWithNoSwordCloseBehindItDoesNotClimb() {
    assertThat(fleeGoal(retreat(Kit.LONGBOW, new Vec3(1.5, 1, 11.5))).y()).isEqualTo(1);
  }
}
