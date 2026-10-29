package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
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
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.function.BiPredicate;
import org.junit.jupiter.api.Test;

/** Reading the ground behind a fighter, and the footwork it leads to. */
final class EdgeFootingTest {

  /** Stone at y=4 where {@code deck} holds, over nothing; {@code extra} adds blocks. */
  private record Deck(BiPredicate<Integer, Integer> deck, Extra extra)
      implements BlockClassification {

    interface Extra {
      boolean solid(int x, int y, int z);
    }

    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 32, 10, 32);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return (y == 4 && deck.test(x, z)) || extra.solid(x, y, z)
          ? BlockShape.FULL
          : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  /** A bridge seven blocks wide, z 10 to 16, the length of the map. */
  private static final Deck BRIDGE = new Deck((x, z) -> z >= 10 && z <= 16, (x, y, z) -> false);

  private static VoxelGrid grid(Deck deck) {
    return nav(deck).grid();
  }

  private static NavArtifact nav(Deck deck) {
    return MapBaker.bake("deck", deck, new NavSites(List.of(), List.of()));
  }

  private static final Vec3 NEAR_EDGE = new Vec3(16.5, 5, 15.5);
  private static final Vec3 ACROSS = new Vec3(0, 0, 1);
  private static final Vec3 ALONG = new Vec3(1, 0, 0);

  @Test
  void aBlowAcrossTheBridgeCarriesItsVictimOverAndOneAlongItDoesNot() {
    var grid = grid(BRIDGE);
    assertThat(CombatFootwork.dropAlong(grid, NEAR_EDGE, ACROSS, CombatFootwork.PUSH_REACH))
        .isTrue();
    assertThat(CombatFootwork.dropAlong(grid, NEAR_EDGE, ALONG, CombatFootwork.SPRINT_PUSH_REACH))
        .isFalse();
    // Five blocks of deck the other way: a plain blow stays on it, a sprint hit does not.
    var back = ACROSS.scale(-1);
    assertThat(CombatFootwork.dropAlong(grid, NEAR_EDGE, back, CombatFootwork.PUSH_REACH))
        .isFalse();
    assertThat(CombatFootwork.dropAlong(grid, NEAR_EDGE, back, CombatFootwork.SPRINT_PUSH_REACH))
        .isTrue();
  }

  @Test
  void aWallStopsThePushButARailIsCarriedOver() {
    var walled = new Deck(BRIDGE.deck(), (x, y, z) -> z == 17 && (y == 5 || y == 6));
    var railed = new Deck(BRIDGE.deck(), (x, y, z) -> z == 17 && y == 5);
    assertThat(CombatFootwork.dropAlong(grid(walled), NEAR_EDGE, ACROSS, 6)).isFalse();
    assertThat(CombatFootwork.dropAlong(grid(railed), NEAR_EDGE, ACROSS, 6)).isTrue();
  }

  @Test
  void aLedgeAFewBlocksDownIsGroundButADeeperOneIsADrop() {
    var step = new Deck(BRIDGE.deck(), (x, y, z) -> y == 1 && z > 16);
    var deep = new Deck(BRIDGE.deck(), (x, y, z) -> y == 0 && z > 16);
    assertThat(CombatFootwork.dropAlong(grid(step), NEAR_EDGE, ACROSS, 6)).isFalse();
    assertThat(CombatFootwork.dropAlong(grid(deep), NEAR_EDGE, ACROSS, 6)).isTrue();
  }

  @Test
  void belowTheBakedMapIsTheVoidNotAWall() {
    var low = new Deck((x, z) -> false, (x, y, z) -> y == 0 && z <= 16);
    var self = combatant(1, RED, new Vec3(16.5, 1, 16.5));
    assertThat(CombatFootwork.dropAlong(grid(low), self.pos(), ACROSS, 3)).isTrue();
    assertThat(CombatFootwork.safe(grid(low), self, ACROSS)).isFalse();
  }

  @Test
  void aCombatStepMayComeDownOffARailButNotOverADrop() {
    var railed = grid(new Deck(BRIDGE.deck(), (x, y, z) -> z == 17 && y == 5));
    var onRail = combatant(1, RED, new Vec3(16.5, 6, 17.5));
    assertThat(CombatFootwork.safe(railed, onRail, ACROSS.scale(-1)))
        .as("back onto the deck")
        .isTrue();
    assertThat(CombatFootwork.safe(railed, onRail, ACROSS)).as("off the far side").isFalse();
  }

  @Test
  void aBotWithTheEnemyAcrossTheDeckIsExposedAndOneAlongItIsNot() {
    var grid = grid(BRIDGE);
    var self = combatant(1, RED, NEAR_EDGE);
    var across = combatant(2, BLUE, NEAR_EDGE.plus(0, 0, -2.8));
    var along = combatant(2, BLUE, NEAR_EDGE.plus(-2.8, 0, 0));
    assertThat(EdgeFooting.read(grid, self, across, new Vec3(0, 0, -1)).exposed()).isTrue();
    assertThat(EdgeFooting.read(grid, self, along, new Vec3(-1, 0, 0)).exposed()).isFalse();
  }

  @Test
  void aBotPressesAnEnemyWhoseBackIsToTheDrop() {
    var wide = grid(new Deck((x, z) -> z <= 16, (x, y, z) -> false));
    var self = combatant(1, RED, NEAR_EDGE.plus(0, 0, -3));
    var enemy = combatant(2, BLUE, NEAR_EDGE);
    var read = EdgeFooting.read(wide, self, enemy, new Vec3(0, 0, 1));
    assertThat(read.exposed()).isFalse();
    assertThat(read.opening()).isTrue();
  }

  @Test
  void aCorneredBotCirclesTowardsTheMiddleOfTheDeck() {
    // The deck ends at x=18: circling east would take the bot off it.
    var corner = grid(new Deck((x, z) -> z <= 16 && x <= 18, (x, y, z) -> false));
    var self = combatant(1, RED, NEAR_EDGE.plus(1.5, 0, 0));
    var enemy = combatant(2, BLUE, NEAR_EDGE.plus(1.5, 0, -3));
    var radial = new Vec3(0, 0, -1);
    var read = EdgeFooting.read(corner, self, enemy, radial);
    assertThat(read.exposed()).isTrue();
    // The strafe's sideways step is (-radial.z, 0, radial.x) times the side: -1 steps west.
    assertThat(read.side()).isEqualTo(-1);
  }

  @Test
  void aBotWithADropBehindItLeansInRatherThanBackingOff() {
    var self = combatant(1, RED, NEAR_EDGE).withMotion(true, true);
    // Closer than the strafing band: on open ground the bot would back off, here over the edge.
    var enemy = combatant(2, BLUE, NEAR_EDGE.plus(0, 0, -1.8));
    var step = move(nav(BRIDGE), self, enemy);
    assertThat(step.waypoint().z() - self.pos().z())
        .as("step %s from %s", step.waypoint(), self.pos())
        .isLessThanOrEqualTo(0.0);
  }

  private static BodyCommand.MoveToward move(
      NavArtifact nav, CombatantView self, CombatantView enemy) {
    var now = 100L;
    var decision =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(enemy.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.of(enemy.pos()),
            Optional.empty(),
            "engage:fight",
            now,
            1,
            Optional.empty());
    var world =
        new WorldSnapshot(
            now,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            "deck",
            List.of(),
            List.of(),
            List.of());
    var input = new ReflexInput(self, world, decision, Optional.of(enemy), 0, List.of(enemy));
    var context =
        new ReflexContext(
            nav, levers(0.65), Loadout.standard(Kit.TROOPER), ReflexContext.Habits.NONE);
    return Reflex.tick(
            ReflexState.initial(Facing.looking(self.eye(), enemy.eye())).withPath(0, now),
            input,
            context,
            new SplittableRandom(5))
        .commands()
        .stream()
        .filter(BodyCommand.MoveToward.class::isInstance)
        .map(BodyCommand.MoveToward.class::cast)
        .findFirst()
        .orElseThrow();
  }
}
