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
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** When a melee bot weaves in on an archer, and which way each leg goes. */
final class WeaveTest {

  /** A stone floor that ends at x=20, with nothing under it beyond. */
  private static final class Ledge implements BlockClassification {
    private final GridBounds bounds = new GridBounds(new BlockPos(0, 0, 0), 32, 6, 48);

    @Override
    public GridBounds bounds() {
      return bounds;
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return y == 0 && x < 20 ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  private static final NavArtifact LEDGE =
      MapBaker.bake("ledge", new Ledge(), new NavSites(List.of(), List.of()));

  private static final long NOW = 100;

  private static CombatantView archer(Vec3 at, boolean drawing) {
    var view = combatant(9, BLUE, at);
    return new CombatantView(
        view.id(),
        view.team(),
        false,
        Kit.LONGBOW,
        true,
        at,
        Vec3.ZERO,
        180,
        0,
        20,
        0,
        15,
        1,
        false,
        true,
        drawing,
        false,
        -1,
        view.traversal(),
        view.quiver(),
        false,
        false,
        drawing);
  }

  @Test
  void aDrawnBowInMidRangeIsWeavedAtAndAnythingElseIsChargedStraight() {
    var drawn = archer(new Vec3(10.5, 1, 40.5), true);
    assertThat(Weave.applies(drawn, 20, Kit.Body.PLAIN)).isTrue();
    assertThat(Weave.applies(archer(new Vec3(10.5, 1, 40.5), false), 20, Kit.Body.PLAIN))
        .as("not drawing")
        .isFalse();
    assertThat(Weave.applies(drawn, 5, Kit.Body.PLAIN)).as("close in").isFalse();
    assertThat(Weave.applies(drawn, 35, Kit.Body.PLAIN)).as("far off").isFalse();
    assertThat(Weave.applies(drawn, 20, Kit.Body.CHARGE)).as("an Inertia").isFalse();
  }

  @Test
  void legsFlipEverySixToNineTicksAndAReactionAfterAShot() {
    var random = new SplittableRandom(3);
    var state = ReflexState.initial(Facing.SOUTH).withStrafe(1, NOW + 5);
    assertThat(Weave.legs(state, new Weave.Loose(NOW, false, 4), random).strafeDir()).isEqualTo(1);
    for (var i = 0; i < 50; i++) {
      var flipped = Weave.legs(state, new Weave.Loose(NOW + 5, false, 4), random);
      assertThat(flipped.strafeDir()).isEqualTo(-1);
      assertThat(flipped.nextStrafeFlip()).isBetween(NOW + 11, NOW + 14);
    }
    var shot = Weave.legs(state, new Weave.Loose(NOW, true, 3), random);
    assertThat(shot.strafeDir()).isEqualTo(1);
    assertThat(shot.nextStrafeFlip()).isEqualTo(NOW + 3);
  }

  @Test
  void aLooseIsTheArchersOwnShotThisTick() {
    var bow = archer(new Vec3(10.5, 1, 40.5), true);
    var self = combatant(1, RED, new Vec3(10.5, 1, 20.5));
    assertThat(Weave.loosed(input(self, bow, List.of(shot(bow.id(), NOW))), bow)).isTrue();
    assertThat(Weave.loosed(input(self, bow, List.of(shot(new CombatantId(7), NOW))), bow))
        .as("someone else's")
        .isFalse();
    assertThat(Weave.loosed(input(self, bow, List.of(shot(bow.id(), NOW - 1))), bow))
        .as("last tick's")
        .isFalse();
  }

  @Test
  void aLegNeverRunsTowardsADrop() {
    var self = combatant(1, RED, new Vec3(19.7, 1, 20.5));
    var radial = new Vec3(0, 0, 1);
    // North-bound, +1 steps west (-x) and -1 steps east, over the edge.
    assertThat(Weave.side(LEDGE.grid(), self, radial, -1)).isEqualTo(1);
    assertThat(Weave.side(LEDGE.grid(), self, radial, 1)).isEqualTo(1);
  }

  @Test
  void aSwordsmanChargingADrawnBowStepsAcrossItsLineAndKeepsSprinting() {
    var self =
        combatant(1, RED, new Vec3(10.5, 1, 20.5))
            .withVel(new Vec3(0, 0, 0.28))
            .withMotion(true, true);
    var weaving = move(self, archer(new Vec3(10.5, 1, 40.5), true));
    var straight = move(self, archer(new Vec3(10.5, 1, 40.5), false));

    var across = weaving.waypoint().minus(self.pos()).horizontal().normalized();
    assertThat(Math.abs(across.x())).as("sideways share of %s", across).isGreaterThan(0.4);
    assertThat(weaving.sprint()).isTrue();
    var ahead = straight.waypoint().minus(self.pos()).horizontal().normalized();
    assertThat(Math.abs(ahead.x())).isLessThan(0.3);
  }

  private static BodyCommand.MoveToward move(CombatantView self, CombatantView archer) {
    var decision =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(archer.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.of(archer.pos()),
            Optional.empty(),
            "engage:fight",
            NOW,
            1,
            Optional.empty());
    var input =
        new ReflexInput(
            self,
            world(List.of(self, archer), List.of()),
            decision,
            Optional.of(archer),
            0,
            List.of(archer),
            Optional.empty());
    var context =
        new ReflexContext(
            LEDGE, levers(0.65), Loadout.standard(Kit.TROOPER), ReflexContext.Habits.NONE);
    return Reflex.tick(
            ReflexState.initial(new Facing(180, 0)).withPath(0, NOW),
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

  private static ReflexInput input(CombatantView self, CombatantView bow, List<Stimulus> heard) {
    return new ReflexInput(
        self,
        world(List.of(self, bow), heard),
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(bow.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight",
            NOW,
            1,
            Optional.empty()),
        Optional.of(bow),
        0,
        List.of(bow),
        Optional.empty());
  }

  private static Stimulus shot(CombatantId archer, long tick) {
    return Stimulus.by(Stimulus.Kind.BOW_SHOT, new Vec3(10.5, 1, 40.5), tick, archer);
  }

  private static WorldSnapshot world(List<CombatantView> views, List<Stimulus> heard) {
    return new WorldSnapshot(
        NOW,
        MatchPhase.LIVE,
        views,
        List.of(),
        PoisonView.NONE,
        "ledge",
        heard,
        List.of(),
        List.of());
  }
}
