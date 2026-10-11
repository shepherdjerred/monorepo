package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class ReflexTest {

  private static final NavArtifact NAV = SyntheticMap.bake();

  private static ReflexContext context(Levers levers) {
    return new ReflexContext(NAV.grid(), levers, Loadout.standard(Kit.TROOPER));
  }

  private static WorldSnapshot world(long tick, List<CombatantView> views, List<BombView> bombs) {
    return new WorldSnapshot(
        tick, MatchPhase.LIVE, views, bombs, PoisonView.NONE, "synthetic", List.of());
  }

  private static Decision fight(CombatantView self, CombatantView target, long tick) {
    return new Decision(
        self.id(),
        Option.ENGAGE,
        Optional.of(target.id()),
        List.of(),
        Stance.AGGRESSIVE,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "engage:fight",
        tick,
        0);
  }

  @Test
  void aLongSmoothedFinalSegmentStillSeparatesButAReachedGoalDoesNotOrbit() {
    assertThat(walkNear(new Vec3(12.5, 1, 5.5)).waypoint().z()).isLessThan(5.5);
    assertThat(walkNear(new Vec3(6.5, 1, 5.5)).waypoint()).isEqualTo(new Vec3(6.5, 1, 5.5));
  }

  private static BodyCommand.MoveToward walkNear(Vec3 destination) {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, new Vec3(5.5, 1, 7.5));
    var decision =
        new Decision(
            self.id(),
            Option.TAKE_SLOT,
            Optional.empty(),
            List.of(new Waypoint(destination, Hop.WALK)),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "following",
            1,
            0);
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self, world(1, List.of(self, ally), List.of()), decision, Optional.empty(), 3),
            context(levers(1)),
            new SplittableRandom(7));
    return step.commands().stream()
        .filter(BodyCommand.MoveToward.class::isInstance)
        .map(BodyCommand.MoveToward.class::cast)
        .findFirst()
        .orElseThrow();
  }

  @Test
  void aMovingAttackerTracksATargetWithTheSameLateralVelocity() {
    var motion = new Vec3(0, 0, 0.3);
    var self =
        combatant(1, RED, new Vec3(5.5, 1, 5.5))
            .withFacing(new Facing(-90, 0))
            .withVel(motion)
            .withHands(1, false);
    var target = combatant(2, BLUE, new Vec3(8, 1, 5.5)).withVel(motion);
    var state = ReflexState.initial(self.facing());
    var random = new SplittableRandom(7);
    var hits = 0;
    for (var tick = 1; tick <= 30; tick++) {
      var snapshot = world(tick, List.of(self, target), List.of());
      var step =
          Reflex.tick(
              state,
              new ReflexInput(self, snapshot, fight(self, target, 1), Optional.of(target), 3),
              context(levers(1)),
              random);
      hits += (int) step.commands().stream().filter(BodyCommand.Attack.class::isInstance).count();
      state = step.state();
      self = self.withPos(self.pos().plus(motion)).withFacing(state.aim().look());
      target = target.withPos(target.pos().plus(motion));
    }
    assertThat(hits).isGreaterThanOrEqualTo(5);
  }

  @Test
  void pursuitSpendsMostMovementClosingOnATargetOutsideContactRange() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var target = combatant(2, BLUE, new Vec3(13.5, 1, 5.5));
    var snapshot = world(1, List.of(self, target), List.of());
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(self, snapshot, fight(self, target, 1), Optional.of(target), 3),
            context(levers(1)),
            new SplittableRandom(7));
    var move =
        step.commands().stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    assertThat(move.waypoint().minus(self.pos()).normalized().dot(new Vec3(1, 0, 0)))
        .isGreaterThan(.9);
    assertThat(move.sprint()).isTrue();
  }

  @Test
  void pursuitDoesNotSpendASwingCooldownBeforeSwordContact() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withFacing(new Facing(-90, 0));
    var target = combatant(2, BLUE, new Vec3(9.8, 1, 5.5));
    var random = new SplittableRandom(7);
    var first =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(1, List.of(self, target), List.of()),
                fight(self, target, 1),
                Optional.of(target),
                3),
            context(levers(1)),
            random);
    assertThat(first.commands())
        .noneMatch(
            command ->
                command instanceof BodyCommand.Swing || command instanceof BodyCommand.Attack);
    target = target.withPos(new Vec3(8, 1, 5.5));
    var contact =
        Reflex.tick(
            first.state(),
            new ReflexInput(
                self,
                world(2, List.of(self, target), List.of()),
                fight(self, target, 1),
                Optional.of(target),
                3),
            context(levers(1)),
            random);
    assertThat(contact.commands()).anyMatch(BodyCommand.Attack.class::isInstance);
  }

  @Test
  void meleeStaysGroundedBecauseRwfDoesNotRewardAirborneHits() {
    for (var seed = 1; seed <= 5; seed++) {
      var commands = melee(levers(1), 200, seed).stream().flatMap(List::stream).toList();
      assertThat(commands).noneMatch(BodyCommand.Jump.class::isInstance);
      assertThat(commands).anyMatch(BodyCommand.Attack.class::isInstance);
    }
  }

  /** Runs {@code ticks} of melee against a target standing two and a half blocks east. */
  private static List<List<BodyCommand>> melee(Levers levers, int ticks, long seed) {
    var random = new SplittableRandom(seed);
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withFacing(new Facing(-90, 0));
    var target = combatant(2, BLUE, new Vec3(8.0, 1, 5.5));
    var state = ReflexState.initial(self.facing());
    var perTick = new ArrayList<List<BodyCommand>>();
    for (var tick = 1; tick <= ticks; tick++) {
      var snapshot = world(tick, List.of(self, target), List.of());
      var input = new ReflexInput(self, snapshot, fight(self, target, 1), Optional.of(target), 3);
      var step = Reflex.tick(state, input, context(levers), random);
      state = step.state();
      perTick.add(step.commands());
      self = self.withFacing(state.aim().look());
    }
    return perTick;
  }

  @Test
  void clicksNeverExceedCpsInAnyOneSecondWindow() {
    for (var skill : new double[] {0, 0.3, 0.7, 1}) {
      var levers = levers(skill);
      var perTick = melee(levers, 400, 7);
      var clicks = new int[perTick.size()];
      for (var i = 0; i < perTick.size(); i++) {
        clicks[i] =
            (int)
                perTick.get(i).stream()
                    .filter(c -> c instanceof BodyCommand.Attack || c instanceof BodyCommand.Swing)
                    .count();
      }
      var total = 0;
      for (var start = 0; start + 20 <= clicks.length; start++) {
        var window = 0;
        for (var i = start; i < start + 20; i++) {
          window += clicks[i];
        }
        assertThat(window)
            .as("skill %s window at %d", skill, start)
            .isLessThanOrEqualTo((int) Math.ceil(levers.cps()));
        total += clicks[start];
      }
      assertThat(total).as("skill %s clicks at all", skill).isGreaterThan(50);
    }
  }

  @Test
  void attacksOnlyWhenTheLookRayHitsAndSwingsOtherwise() {
    var perTick = melee(levers(1), 200, 3);
    var attacks =
        perTick.stream().flatMap(List::stream).filter(BodyCommand.Attack.class::isInstance).count();
    var swings =
        perTick.stream().flatMap(List::stream).filter(BodyCommand.Swing.class::isInstance).count();
    assertThat(attacks).isGreaterThan(20);
    assertThat(swings).isLessThan(attacks);
    assertThat(perTick.getFirst()).anyMatch(BodyCommand.Look.class::isInstance);
  }

  @Test
  void fuseClickGapsStayUnderTheResetAtHighSkillAndSlipAtLowSkill() {
    var skilled = gaps(levers(1), 2000);
    var clumsy = gaps(levers(0).with(Lever.TECHNIQUE, 0.2), 2000);
    assertThat(skilled).allMatch(gap -> gap < Reflex.FUSE_RESET_GAP);
    assertThat(skilled).allMatch(gap -> gap == Reflex.FUSE_BASE_GAP);
    assertThat(clumsy).anyMatch(gap -> gap >= Reflex.FUSE_RESET_GAP);
    assertThat(clumsy.stream().mapToInt(Integer::intValue).average().orElseThrow())
        .isGreaterThan(skilled.stream().mapToInt(Integer::intValue).average().orElseThrow());
  }

  private static List<Integer> gaps(Levers levers, int samples) {
    var random = new SplittableRandom(9);
    var out = new ArrayList<Integer>();
    for (var i = 0; i < samples; i++) {
      out.add(Reflex.fuseGap(levers, random));
    }
    return out;
  }

  @Test
  void clicksTheBombWhenStandingNextToIt() {
    var random = new SplittableRandom(2);
    var self = combatant(1, RED, SyntheticMap.BLUE_BOMB.offset(1, 0, 0).feet());
    var bomb =
        new BombView(
            new BombId(1),
            new BombOwner.Team(BLUE),
            SyntheticMap.BLUE_BOMB.center(),
            new BombState.Idle());
    var decision =
        new Decision(
            self.id(),
            Option.ARM,
            Optional.empty(),
            List.of(),
            Stance.CAUTIOUS,
            Optional.of(bomb.id()),
            Optional.empty(),
            Optional.empty(),
            "arm:arm",
            1,
            0);
    var state = ReflexState.initial(self.facing());
    var clicks = new ArrayList<Long>();
    for (var tick = 1; tick <= 100; tick++) {
      var input =
          new ReflexInput(
              self, world(tick, List.of(self), List.of(bomb)), decision, Optional.empty(), 3);
      var step = Reflex.tick(state, input, context(levers(1)), random);
      state = step.state();
      if (step.commands().stream().anyMatch(c -> c.equals(new BodyCommand.ClickBomb(bomb.id())))) {
        clicks.add((long) tick);
      }
    }
    assertThat(clicks).hasSizeGreaterThan(10);
    for (var i = 1; i < clicks.size(); i++) {
      assertThat(clicks.get(i) - clicks.get(i - 1)).isLessThan(Reflex.FUSE_RESET_GAP);
    }
  }

  @Test
  void eatsWhenLowAndSafeThenStopsOnceHealthyWithHysteresis() {
    var random = new SplittableRandom(4);
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withHealth(8, 0);
    var decision = Decision.idle(self.id(), 1, 0);
    var state = ReflexState.initial(self.facing());
    var started = 0;
    var tick = 0;
    while (tick < 200) {
      tick++;
      var input =
          new ReflexInput(
              self, world(tick, List.of(self), List.of()), decision, Optional.empty(), 3);
      var step = Reflex.tick(state, input, context(levers(0.5)), random);
      state = step.state();
      if (step.commands().contains(new BodyCommand.StartUse())) {
        started++;
      }
      if (step.commands().contains(new BodyCommand.ReleaseUse())) {
        self = self.withHealth(Math.min(20, self.health() + 4), 0);
      }
    }
    assertThat(started).isEqualTo(2);
    assertThat(self.health()).isGreaterThanOrEqualTo(Reflex.EAT_UNTIL);
    assertThat(state.isEating()).isFalse();
  }

  @Test
  void walkingCorrectionGrowsAsTheGapToATeammateShrinks() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var near = combatant(2, RED, self.pos().plus(0, 0, 2));
    var far = combatant(2, RED, self.pos().plus(0, 0, 2.75));
    var nearMove = walkingMove(self, near);
    var farMove = walkingMove(self, far);
    assertThat(nearMove.waypoint().x()).isGreaterThan(self.pos().x());
    assertThat(nearMove.waypoint().z()).isLessThan(farMove.waypoint().z());
  }

  @Test
  void walkingLeavesAResponseMarginBeyondTheMeleeSpacingBand() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, new Vec3(5.5, 1, 8.25));
    var move = walkingMove(self, ally);
    assertThat(move.waypoint().x()).isGreaterThan(self.pos().x());
    assertThat(move.waypoint().z()).isLessThan(self.pos().z());
  }

  @Test
  void walkersAnticipateConvergingTeammatesBeforeTheyCrossTheSpacingBand() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, self.pos().plus(0, 0, 3.25));
    var stationary = walkingMove(self, ally);
    var converging = walkingMove(self, ally.withVel(new Vec3(0, 0, -0.2)));
    assertThat(stationary.waypoint().z()).isEqualTo(self.pos().z());
    assertThat(converging.waypoint().z()).isLessThan(self.pos().z());
    assertThat(converging.waypoint().x()).isGreaterThan(self.pos().x());
  }

  @Test
  void walkersAvoidTeammatesCrossingBetweenDistantPredictionEndpoints() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, self.pos().plus(0, 0, 3.25)).withVel(new Vec3(0, 0, -7));
    var move = walkingMove(self, ally);
    assertThat(move.waypoint().z()).isLessThan(self.pos().z());
    assertThat(move.waypoint().x()).isGreaterThan(self.pos().x());
  }

  @Test
  void walkersIgnoreConvergenceOutsideTheirReactionWindowAndRecedingTeammates() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var distant = combatant(2, RED, self.pos().plus(0, 0, 100)).withVel(new Vec3(0, 0, -0.2));
    var receding = combatant(2, RED, self.pos().plus(0, 0, 3.25)).withVel(new Vec3(0, 0, 0.2));
    assertThat(walkingMove(self, distant).waypoint().z()).isEqualTo(self.pos().z());
    assertThat(walkingMove(self, receding).waypoint().z()).isEqualTo(self.pos().z());
  }

  private static BodyCommand.MoveToward walkingMove(CombatantView self, CombatantView ally) {
    var path =
        java.util.stream.IntStream.rangeClosed(1, 5)
            .mapToObj(step -> new Waypoint(self.pos().plus(step * 2, 0, 0), Hop.WALK))
            .toList();
    var decision =
        new Decision(
            self.id(),
            Option.TAKE_SLOT,
            Optional.empty(),
            path,
            Stance.CAUTIOUS,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "take_slot:route",
            1,
            0);
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self, world(1, List.of(self, ally), List.of()), decision, Optional.empty(), 0),
            context(levers(1)),
            new SplittableRandom(4));
    return step.commands().stream()
        .filter(BodyCommand.MoveToward.class::isInstance)
        .map(BodyCommand.MoveToward.class::cast)
        .findFirst()
        .orElseThrow();
  }

  @Test
  void holdingAndDrawingLeaveRoomForTeammatesAndStopWhenUncrowded() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, new Vec3(7.5, 1, 5.5));
    var enemy = combatant(3, BLUE, new Vec3(25.5, 1, 5.5));
    var holding =
        new Decision(
            self.id(),
            Option.HOLD_SLOT,
            Optional.empty(),
            List.of(),
            Stance.CAUTIOUS,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "hold-slot:hold",
            1,
            0);
    var context = new ReflexContext(NAV.grid(), levers(1), Loadout.standard(Kit.LONGBOW));
    for (var target : List.of(Optional.<CombatantView>empty(), Optional.of(enemy))) {
      var step =
          Reflex.tick(
              ReflexState.initial(self.facing()),
              new ReflexInput(
                  self, world(1, List.of(self, ally, enemy), List.of()), holding, target, 0),
              context,
              new SplittableRandom(4));
      assertThat(step.commands())
          .contains(new BodyCommand.MoveToward(new Vec3(4.5, 1, 5.5), false));
      assertThat(step.commands()).doesNotContain(new BodyCommand.Stop());
      if (target.isPresent()) assertThat(step.commands()).contains(new BodyCommand.StartUse());
    }
    var uncrowded =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self, world(1, List.of(self, enemy), List.of()), holding, Optional.empty(), 0),
            context,
            new SplittableRandom(4));
    assertThat(uncrowded.commands()).contains(new BodyCommand.Stop());
  }

  @Test
  void aBotHoldingItsSlotMakesRoomForANearbyTeammate() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, self.pos().plus(2.75, 0, 0));
    var decision =
        new Decision(
            self.id(),
            Option.HOLD_SLOT,
            Optional.empty(),
            List.of(),
            Stance.CAUTIOUS,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "hold-slot:hold",
            1,
            0);
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self, world(1, List.of(self, ally), List.of()), decision, Optional.empty(), 3),
            context(levers(0.5)),
            new SplittableRandom(1));
    assertThat(step.commands())
        .contains(new BodyCommand.MoveToward(self.pos().plus(-1, 0, 0), false));
    assertThat(step.commands()).anyMatch(BodyCommand.Look.class::isInstance);
  }

  @Test
  void anEnemyInReachInterruptsEating() {
    var random = new SplittableRandom(4);
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withHealth(6, 0);
    var enemy = combatant(2, BLUE, new Vec3(30.5, 1, 30.5));
    var decision = Decision.idle(self.id(), 1, 0);
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self, world(1, List.of(self, enemy), List.of()), decision, Optional.of(enemy), 3),
            context(levers(0.5)),
            random);
    assertThat(step.state().isEating()).isTrue();
    var closeEnemy = enemy.withPos(new Vec3(7.5, 1, 5.5));
    var interrupted =
        Reflex.tick(
            step.state(),
            new ReflexInput(
                self,
                world(2, List.of(self, closeEnemy), List.of()),
                decision,
                Optional.of(closeEnemy),
                3),
            context(levers(0.5)),
            random);
    assertThat(interrupted.state().isEating()).isFalse();
    assertThat(interrupted.commands()).contains(new BodyCommand.ReleaseUse());
  }
}
