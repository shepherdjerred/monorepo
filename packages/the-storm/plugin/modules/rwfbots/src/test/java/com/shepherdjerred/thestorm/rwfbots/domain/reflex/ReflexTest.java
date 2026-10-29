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
import com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver;
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
        tick,
        MatchPhase.LIVE,
        views,
        bombs,
        PoisonView.NONE,
        "synthetic",
        List.of(),
        List.of(),
        List.of());
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
        0,
        java.util.Optional.empty());
  }

  @Test
  void anAuthoredDiagonalLeapJumpsFromItsGroundedLaunchBeforeMovingAcrossTheGap() {
    var direction = new Vec3(1, 0, 1).normalized();
    var self =
        combatant(1, RED, new Vec3(4.5, 1, 4.5))
            .withVel(direction.scale(0.28))
            .withMotion(true, true);
    var landing = self.pos().plus(3, 0, 3);
    var launch =
        new com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch(
            self.pos(), self.pos().minus(direction.scale(2)), 0.27, 13);
    var decision =
        new Decision(
            self.id(),
            Option.TAKE_SLOT,
            Optional.empty(),
            List.of(new Waypoint(landing, Hop.LEAP, Optional.of(launch))),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "diagonal leap",
            20,
            0,
            Optional.empty());
    var input =
        new ReflexInput(
            self, world(20, List.of(self), List.of()), decision, Optional.empty(), 0, List.of());
    var step =
        Reflex.tick(
            ReflexState.initial(Facing.SOUTH),
            input,
            context(levers(0.8)),
            new SplittableRandom(4));
    assertThat(step.commands())
        .contains(new BodyCommand.Jump(), new BodyCommand.MoveToward(landing, true, Hop.LEAP));
    var airborne = self.withMotion(false, false);
    var flight =
        Reflex.tick(
            step.state(),
            new ReflexInput(
                airborne,
                world(21, List.of(airborne), List.of()),
                decision,
                Optional.empty(),
                0,
                List.of()),
            context(levers(0.8)),
            new SplittableRandom(4));
    assertThat(flight.commands()).doesNotContain(new BodyCommand.Jump());
  }

  @Test
  void convergingCombatTeammatesLeaveRoomBeforeTheyEnterTheMovingSpacingBand() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var target = combatant(2, BLUE, new Vec3(8.7, 1, 5.5));
    var ally = combatant(3, RED, self.pos().plus(0, 0, Reflex.WALK_SEPARATION + 0.5));
    var context = context(levers(0));
    var decision = fight(self, target, 1);
    var state = ReflexState.initial(self.facing()).withStrafe(1, 100);
    var alone =
        Reflex.tick(
            state,
            new ReflexInput(
                self,
                world(1, List.of(self, target), List.of()),
                decision,
                Optional.of(target),
                0,
                List.of()),
            context,
            new SplittableRandom(7));
    var stationary =
        Reflex.tick(
            state,
            new ReflexInput(
                self,
                world(1, List.of(self, target, ally), List.of()),
                decision,
                Optional.of(target),
                0,
                List.of()),
            context,
            new SplittableRandom(7));
    var converging =
        Reflex.tick(
            state,
            new ReflexInput(
                self,
                world(1, List.of(self, target, ally.withVel(new Vec3(0, 0, -0.4))), List.of()),
                decision,
                Optional.of(target),
                0,
                List.of()),
            context,
            new SplittableRandom(7));
    assertThat(stationary.commands()).isEqualTo(alone.commands());
    var baseline =
        alone.commands().stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    var separated =
        converging.commands().stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    assertThat(separated.waypoint().z()).isLessThan(baseline.waypoint().z());
    assertThat(CombatFootwork.safe(NAV.grid(), self, separated.waypoint().minus(self.pos())))
        .isTrue();
  }

  @Test
  void teammatesOnAnotherFloorDoNotPushTheFighterSideways() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(3, RED, new Vec3(5.5, 5, 7.5));
    var target = combatant(2, BLUE, new Vec3(8.3, 1, 5.5));
    var decision = fight(self, target, 1);
    var context = context(levers(1));
    var without =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(1, List.of(self, target), List.of()),
                decision,
                Optional.of(target),
                0,
                List.of()),
            context,
            new SplittableRandom(7));
    var above =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(1, List.of(self, target, ally), List.of()),
                decision,
                Optional.of(target),
                0,
                List.of()),
            context,
            new SplittableRandom(7));
    assertThat(above.commands()).isEqualTo(without.commands());
  }

  @Test
  void aRetreatingBotReturnsContactHitsWithoutAbandoningItsEscapeRoute() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5)).withFacing(new Facing(-90, 0));
    var target = combatant(2, BLUE, new Vec3(8, 1, 5.5));
    var destination = new Vec3(2.5, 1, 5.5);
    var decision =
        new Decision(
            self.id(),
            Option.RETREAT,
            Optional.of(target.id()),
            List.of(new Waypoint(destination, Hop.WALK)),
            Stance.EVASIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "retreat",
            1,
            0,
            Optional.empty());
    var state = ReflexState.initial(self.facing());
    var random = new SplittableRandom(7);
    var attacks = 0;
    for (var tick = 1; tick <= 12; tick++) {
      var step =
          Reflex.tick(
              state,
              new ReflexInput(
                  self,
                  world(tick, List.of(self, target), List.of()),
                  decision,
                  Optional.of(target),
                  0,
                  List.of()),
              context(levers(1)),
              random);
      assertThat(step.commands()).contains(new BodyCommand.MoveToward(destination, true));
      attacks +=
          (int) step.commands().stream().filter(BodyCommand.Attack.class::isInstance).count();
      state = step.state();
    }
    assertThat(attacks).isGreaterThan(0);
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
            0,
            java.util.Optional.empty());
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(1, List.of(self, ally), List.of()),
                decision,
                Optional.empty(),
                3,
                List.of()),
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
              new ReflexInput(
                  self, snapshot, fight(self, target, 1), Optional.of(target), 3, List.of()),
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
            new ReflexInput(
                self, snapshot, fight(self, target, 1), Optional.of(target), 3, List.of()),
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
  void strafingInsideTheSpacingBandKeepsTheSprintItsHitsKnockBackWith() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    for (var gap : new double[] {2.65, 2.75, 2.85}) {
      var target = combatant(2, BLUE, new Vec3(5.5 + gap, 1, 5.5));
      var move = strafeStep(self, target);
      assertThat(move.sprint()).as("gap %s", gap).isTrue();
    }
    // Backing off from a target too close is not forward input and cannot sprint.
    var close = strafeStep(self, combatant(2, BLUE, new Vec3(7.5, 1, 5.5)));
    assertThat(close.sprint()).isFalse();
  }

  private static BodyCommand.MoveToward strafeStep(CombatantView self, CombatantView target) {
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(1, List.of(self, target), List.of()),
                fight(self, target, 1),
                Optional.of(target),
                3,
                List.of()),
            context(levers(1)),
            new SplittableRandom(7));
    return step.commands().stream()
        .filter(BodyCommand.MoveToward.class::isInstance)
        .map(BodyCommand.MoveToward.class::cast)
        .findFirst()
        .orElseThrow();
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
                3,
                List.of()),
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
                3,
                List.of()),
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
      var input =
          new ReflexInput(
              self, snapshot, fight(self, target, 1), Optional.of(target), 3, List.of());
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
  void fuseClickGapsRemainReliableAtEverySkillWhilePreservingSmallTimingVariation() {
    var skilled = gaps(levers(1), 2000);
    var clumsy = gaps(levers(0).with(Lever.TECHNIQUE, 0.2), 2000);
    assertThat(skilled).allMatch(gap -> gap < Reflex.FUSE_RESET_GAP);
    assertThat(skilled).allMatch(gap -> gap == Reflex.FUSE_BASE_GAP);
    assertThat(clumsy).allMatch(gap -> gap <= Reflex.FUSE_RESET_GAP - 3);
    for (var skill = 0; skill <= 10; skill++) {
      assertThat(gaps(levers(skill / 10.0), 2000)).allMatch(gap -> gap + 1 < Reflex.FUSE_RESET_GAP);
    }
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
            0,
            java.util.Optional.empty());
    var state = ReflexState.initial(self.facing());
    var clicks = new ArrayList<Long>();
    for (var tick = 1; tick <= 100; tick++) {
      var input =
          new ReflexInput(
              self,
              world(tick, List.of(self), List.of(bomb)),
              decision,
              Optional.empty(),
              3,
              List.of());
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
              self,
              world(tick, List.of(self), List.of()),
              decision,
              Optional.empty(),
              3,
              List.of());
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
    var ally = combatant(2, RED, self.pos().plus(0, 0, Reflex.SEPARATION + 0.25));
    var move = walkingMove(self, ally);
    assertThat(move.waypoint().x()).isGreaterThan(self.pos().x());
    assertThat(move.waypoint().z()).isLessThan(self.pos().z());
  }

  @Test
  void walkersAnticipateConvergingTeammatesBeforeTheyCrossTheSpacingBand() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally = combatant(2, RED, self.pos().plus(0, 0, Reflex.WALK_SEPARATION + 0.25));
    var stationary = walkingMove(self, ally);
    var converging = walkingMove(self, ally.withVel(new Vec3(0, 0, -0.2)));
    assertThat(stationary.waypoint().z()).isEqualTo(self.pos().z());
    assertThat(converging.waypoint().z()).isLessThan(self.pos().z());
    assertThat(converging.waypoint().x()).isGreaterThan(self.pos().x());
  }

  @Test
  void walkersAvoidTeammatesCrossingBetweenDistantPredictionEndpoints() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var ally =
        combatant(2, RED, self.pos().plus(0, 0, Reflex.WALK_SEPARATION + 0.25))
            .withVel(new Vec3(0, 0, -7));
    var move = walkingMove(self, ally);
    assertThat(move.waypoint().z()).isLessThan(self.pos().z());
    assertThat(move.waypoint().x()).isGreaterThan(self.pos().x());
  }

  @Test
  void walkersIgnoreConvergenceOutsideTheirReactionWindowAndRecedingTeammates() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var distant = combatant(2, RED, self.pos().plus(0, 0, 100)).withVel(new Vec3(0, 0, -0.2));
    var receding =
        combatant(2, RED, self.pos().plus(0, 0, Reflex.WALK_SEPARATION + 0.25))
            .withVel(new Vec3(0, 0, 0.2));
    assertThat(walkingMove(self, distant).waypoint().z()).isEqualTo(self.pos().z());
    assertThat(walkingMove(self, receding).waypoint().z()).isEqualTo(self.pos().z());
  }

  @Test
  void formationPressureCannotReverseTheAuthoredRoute() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var left = combatant(2, RED, self.pos().plus(1.2, 0, 0.4));
    var right = combatant(3, RED, self.pos().plus(1.2, 0, -0.4));
    var move = walkingMove(self, left, right);
    assertThat(move.waypoint().x()).isGreaterThan(self.pos().x());
  }

  private static BodyCommand.MoveToward walkingMove(CombatantView self, CombatantView... allies) {
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
            0,
            java.util.Optional.empty());
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(
                    1,
                    java.util.stream.Stream.concat(
                            java.util.stream.Stream.of(self), java.util.Arrays.stream(allies))
                        .toList(),
                    List.of()),
                decision,
                Optional.empty(),
                0,
                List.of()),
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
            0,
            java.util.Optional.empty());
    var context = new ReflexContext(NAV.grid(), levers(1), Loadout.standard(Kit.LONGBOW));
    for (var target : List.of(Optional.<CombatantView>empty(), Optional.of(enemy))) {
      var step =
          Reflex.tick(
              ReflexState.initial(self.facing()),
              new ReflexInput(
                  self,
                  world(1, List.of(self, ally, enemy), List.of()),
                  holding,
                  target,
                  0,
                  List.of()),
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
                self,
                world(1, List.of(self, enemy), List.of()),
                holding,
                Optional.empty(),
                0,
                List.of()),
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
            0,
            java.util.Optional.empty());
    var step =
        Reflex.tick(
            ReflexState.initial(self.facing()),
            new ReflexInput(
                self,
                world(1, List.of(self, ally), List.of()),
                decision,
                Optional.empty(),
                3,
                List.of()),
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
                self,
                world(1, List.of(self, enemy), List.of()),
                decision,
                Optional.of(enemy),
                3,
                List.of()),
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
                3,
                List.of()),
            context(levers(0.5)),
            random);
    assertThat(interrupted.state().isEating()).isFalse();
    assertThat(interrupted.commands()).contains(new BodyCommand.ReleaseUse());
  }

  // ---- bows -------------------------------------------------------------------------------------

  private static final ReflexContext ARCHER =
      new ReflexContext(NAV.grid(), levers(1), Loadout.standard(Kit.LONGBOW));

  private static final Vec3 ARCHER_AT = new Vec3(5.5, 1, 5.5);

  /** What a run of archer ticks left behind and every command it issued. */
  private record Volley(ReflexState state, List<BodyCommand> commands) {}

  /** An archer at {@link #ARCHER_AT} fighting {@code enemy} among {@code world}. */
  private record Shot(
      CombatantView self,
      CombatantView enemy,
      Decision decision,
      List<CombatantView> world,
      Optional<List<CombatantView>> perceived) {

    Shot(CombatantView self, CombatantView enemy, Decision decision, List<CombatantView> world) {
      this(self, enemy, decision, world, Optional.empty());
    }

    /** The same shot with {@code near} every enemy the archer perceives, nearest first. */
    Shot perceiving(CombatantView... near) {
      return new Shot(self, enemy, decision, world, Optional.of(List.of(near)));
    }

    /** Ticks {@code from} to {@code to}; the enemy is the reflex target only while {@code seen}. */
    Volley run(ReflexState start, long from, long to, boolean seen) {
      return run(start, new Span(from, to), seen, ARCHER);
    }

    /** As {@link #run(ReflexState, long, long, boolean)}, for the archer {@code context}. */
    Volley run(ReflexState start, Span span, boolean seen, ReflexContext context) {
      var from = span.from();
      var to = span.to();
      var state = start;
      var commands = new ArrayList<BodyCommand>();
      for (var tick = from; tick <= to; tick++) {
        var input =
            new ReflexInput(
                self,
                ReflexTest.world(tick, world, List.of()),
                decision,
                seen ? Optional.of(enemy) : Optional.empty(),
                0,
                perceived.orElseGet(() -> seen ? List.of(enemy) : List.of()));
        var step = Reflex.tick(state, input, context, new SplittableRandom(tick));
        state = step.state();
        commands.addAll(step.commands());
      }
      return new Volley(state, commands);
    }
  }

  /** The ticks a run covers, inclusive. */
  private record Span(long from, long to) {}

  private static Shot shot(Vec3 enemyAt, List<Waypoint> path, CombatantView... others) {
    var self = combatant(1, RED, ARCHER_AT);
    var enemy = combatant(2, BLUE, enemyAt);
    var decision =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(enemy.id()),
            path,
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight-peek",
            1,
            0,
            Optional.empty());
    var world =
        java.util.stream.Stream.concat(
                java.util.stream.Stream.of(self, enemy), java.util.Arrays.stream(others))
            .toList();
    return new Shot(self, enemy, decision, world);
  }

  private static final Vec3 FAR_ENEMY = new Vec3(25.5, 1, 5.5);

  /** Five ticks of drawing on a visible enemy, short of a full draw. */
  private static Volley drawing(Shot shot) {
    var volley = shot.run(ReflexState.initial(Facing.SOUTH), 1, 5, true);
    assertThat(volley.commands())
        .contains(new BodyCommand.StartUse())
        .doesNotContain(new BodyCommand.ReleaseUse());
    return volley;
  }

  @Test
  void aDrawnBowStaysReadyWhileTheTargetIsOutOfSightAndFiresWhenItReturns() {
    var shot = shot(FAR_ENEMY, List.of());
    var drawn = drawing(shot);
    // Held well past a full draw and the old forced release, but nothing to shoot at.
    var ready = shot.run(drawn.state(), 6, 5 + Reflex.HOLD_READY_TICKS, false);
    assertThat(ready.commands())
        .doesNotContain(new BodyCommand.CancelUse(), new BodyCommand.ReleaseUse());
    assertThat(ready.state().isDrawing()).isTrue();
    var back =
        shot.run(ready.state(), 6 + Reflex.HOLD_READY_TICKS, 10 + Reflex.HOLD_READY_TICKS, true);
    assertThat(back.commands())
        .contains(new BodyCommand.ReleaseUse())
        .doesNotContain(new BodyCommand.CancelUse());
  }

  @Test
  void aReadyBowKeepsAimOnWhereTheTargetLeftSightWhileTheArcherWalksOn() {
    var path = List.of(new Waypoint(ARCHER_AT.plus(0, 0, 6), Hop.WALK));
    var shot = shot(FAR_ENEMY, path);
    var drawn = drawing(shot);
    var vanished = drawn.state().bowSight().orElseThrow().point();
    var ready = shot.run(drawn.state(), 6, 20, false);
    assertThat(ready.commands()).anyMatch(BodyCommand.MoveToward.class::isInstance);
    var look =
        ready.commands().stream()
            .filter(BodyCommand.Look.class::isInstance)
            .map(BodyCommand.Look.class::cast)
            .reduce((first, second) -> second)
            .orElseThrow();
    var expected = Facing.looking(shot.self().eye(), vanished);
    assertThat(Math.abs(new Facing(look.yaw(), 0).yawDelta(expected))).isLessThan(5);
  }

  @Test
  void aReadyBowIsLoweredToSprintAPathWithNoFightInIt() {
    var path = List.of(new Waypoint(ARCHER_AT.plus(0, 0, 6), Hop.WALK));
    var shot = shot(FAR_ENEMY, path);
    var drawn = drawing(shot);
    var dash =
        new Decision(
            shot.self().id(),
            Option.TAKE_SLOT,
            Optional.empty(),
            path,
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "take_slot:cover",
            6,
            0,
            Optional.empty());
    var running =
        new Shot(shot.self(), shot.enemy(), dash, shot.world()).run(drawn.state(), 6, 6, false);
    assertThat(running.commands()).contains(new BodyCommand.CancelUse());
    assertThat(running.state().isDrawing()).isFalse();
  }

  @Test
  void aReadyBowIsLoweredOnceTheTargetHasBeenGoneTooLong() {
    var shot = shot(FAR_ENEMY, List.of());
    var drawn = drawing(shot);
    var gone = shot.run(drawn.state(), 6, 6 + Reflex.HOLD_READY_TICKS, false);
    assertThat(gone.commands())
        .contains(new BodyCommand.CancelUse())
        .doesNotContain(new BodyCommand.ReleaseUse());
    assertThat(gone.state().isDrawing()).isFalse();
  }

  @Test
  void aReadyBowIsNotLoweredForAnEnemyTheBotDoesNotPerceive() {
    // Review finding: the ready draw scanned the whole world for nearby enemies, so a bot lowered
    // its bow for a player hidden behind a wall or invisible. Only an enemy the bot perceives that
    // close lowers it (see the stealthy case below).
    var drawn = drawing(shot(FAR_ENEMY, List.of()));
    var lurker = combatant(3, BLUE, ARCHER_AT.plus(0, 0, Reflex.MELEE_ALERT - 1));
    var hidden = shot(FAR_ENEMY, List.of(), lurker).run(drawn.state(), 6, 6, false);
    assertThat(hidden.commands()).doesNotContain(new BodyCommand.CancelUse());
    assertThat(hidden.state().isDrawing()).isTrue();
  }

  @Test
  void aStealthyReadyBowIsLoweredForAPerceivedEnemyInsideTheMeleeAlert() {
    // Review finding: a stealthy stance only makes an enemy inside REACH the target, so one the bot
    // perceives between REACH and MELEE_ALERT kept the bow up instead of drawing the sword.
    var drawn = drawing(shot(FAR_ENEMY, List.of()));
    var close = combatant(3, BLUE, ARCHER_AT.plus(0, 0, (Reflex.REACH + Reflex.MELEE_ALERT) / 2));
    var shot = shot(FAR_ENEMY, List.of(), close);
    var decision = shot.decision();
    var stealthy =
        new Decision(
            decision.bot(),
            decision.option(),
            decision.target(),
            decision.waypoints(),
            Stance.STEALTH,
            decision.bomb(),
            decision.watch(),
            decision.ability(),
            decision.planLabel(),
            decision.snapshotTick(),
            decision.lifeEpoch(),
            decision.routeFailure());
    var pressed =
        new Shot(shot.self(), shot.enemy(), stealthy, shot.world())
            .perceiving(close)
            .run(drawn.state(), 6, 6, false);
    assertThat(pressed.commands()).contains(new BodyCommand.CancelUse());
    assertThat(pressed.state().isDrawing()).isFalse();
  }

  @Test
  void aDrawnBowIsKeptInsideTheMinimumRangeUntilTheKeepRange() {
    var drawn = drawing(shot(FAR_ENEMY, List.of()));
    var hovering = ARCHER_AT.plus((Reflex.BOW_KEEP_RANGE + Reflex.BOW_MIN_RANGE) / 2, 0, 0);
    var kept = shot(hovering, List.of()).run(drawn.state(), 6, 6, true);
    assertThat(kept.commands()).doesNotContain(new BodyCommand.CancelUse());
    assertThat(kept.state().isDrawing()).isTrue();
    var fresh = shot(hovering, List.of()).run(ReflexState.initial(Facing.SOUTH), 1, 1, true);
    assertThat(fresh.commands()).doesNotContain(new BodyCommand.StartUse());
    var close = ARCHER_AT.plus(Reflex.BOW_KEEP_RANGE - 0.5, 0, 0);
    var lowered = shot(close, List.of()).run(drawn.state(), 6, 6, true);
    assertThat(lowered.commands()).contains(new BodyCommand.CancelUse());
  }

  @Test
  void aTeammateInTheLineOfFireHoldsTheShot() {
    var inLine = combatant(3, RED, new Vec3(15.5, 1, 5.5));
    var blocked =
        shot(FAR_ENEMY, List.of(), inLine).run(ReflexState.initial(Facing.SOUTH), 1, 60, true);
    assertThat(blocked.commands()).doesNotContain(new BodyCommand.ReleaseUse());
    assertThat(blocked.state().isDrawing()).isTrue();
    var aside = combatant(3, RED, new Vec3(15.5, 1, 9.5));
    var clear =
        shot(FAR_ENEMY, List.of(), aside).run(ReflexState.initial(Facing.SOUTH), 1, 60, true);
    assertThat(clear.commands()).contains(new BodyCommand.ReleaseUse());
  }

  /** {@code shot} turned onto {@code next}, a further enemy, with everyone else still around. */
  private static Shot retarget(Shot shot, CombatantView next) {
    var decision =
        new Decision(
            shot.self().id(),
            Option.ENGAGE,
            Optional.of(next.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight-peek",
            1,
            0,
            Optional.empty());
    var world = new ArrayList<>(shot.world());
    world.add(next);
    return new Shot(shot.self(), next, decision, world);
  }

  @Test
  void aHeldDrawThatSwitchesTargetWaitsForTheAimToSettleOnTheNewOne() {
    // A teammate blocks the first target, so the draw is held past the forced-release window.
    var inLine = combatant(3, RED, new Vec3(15.5, 1, 5.5));
    var first = shot(FAR_ENEMY, List.of(), inLine);
    var held = first.run(ReflexState.initial(Facing.SOUTH), 1, 40, true);
    assertThat(held.commands()).doesNotContain(new BodyCommand.ReleaseUse());
    assertThat(held.state().isDrawing()).isTrue();
    // The planner switches to an enemy a quarter turn away with no unseen tick in between.
    var second = retarget(first, combatant(4, BLUE, new Vec3(5.5, 1, 25.5)));
    var switched = second.run(held.state(), 41, 41, true);
    assertThat(switched.commands()).doesNotContain(new BodyCommand.ReleaseUse());
    assertThat(switched.state().bowSight().orElseThrow().since()).isEqualTo(41);
    var settled = second.run(switched.state(), 42, 41 + ReadyDraw.MAX_BOW_HOLD_TICKS, true);
    assertThat(settled.commands()).contains(new BodyCommand.ReleaseUse());
  }

  @Test
  void aTeammateOnTheLedArrowPathHoldsTheShotButOneOnlyOnTheCurrentRayDoesNot() {
    var vel = new Vec3(0, 0, 0.45);
    var speed = ARCHER.loadout().ranged().projectileSpeed();
    var flight = BowSolver.flightTicks(FAR_ENEMY.horizontalDistance(ARCHER_AT), speed);
    var lead = vel.scale(flight * ARCHER.levers().predictionQuality());
    var eye = combatant(1, RED, ARCHER_AT).eye();
    var led = FAR_ENEMY.plus(lead).plus(0, 1.3, 0);
    var current = FAR_ENEMY.plus(0, 1.3, 0);
    // Four fifths of the way out, where the lead has pulled the arrow well off the current ray.
    var onLed = eye.plus(led.minus(eye).scale(0.8)).plus(0, -1.0, 0);
    var onCurrent = eye.plus(current.minus(eye).scale(0.8)).plus(0, -1.0, 0);
    assertThat(onLed.distance(onCurrent)).isGreaterThan(2 * ReadyDraw.ALLY_CLEARANCE);

    var blocked =
        moving(shot(FAR_ENEMY, List.of(), combatant(3, RED, onLed)), vel)
            .run(ReflexState.initial(Facing.SOUTH), 1, 60, true);
    assertThat(blocked.commands()).doesNotContain(new BodyCommand.ReleaseUse());
    assertThat(blocked.state().isDrawing()).isTrue();
    var clear =
        moving(shot(FAR_ENEMY, List.of(), combatant(3, RED, onCurrent)), vel)
            .run(ReflexState.initial(Facing.SOUTH), 1, 60, true);
    assertThat(clear.commands()).contains(new BodyCommand.ReleaseUse());
  }

  // ---- finite arrows ----------------------------------------------------------------------------

  private static final Quiver LOW = Quiver.of(ArrowEconomy.CONSERVE_BELOW - 1);

  /** {@code shot}, by an archer carrying {@code quiver}. */
  private static Shot carrying(Shot shot, Quiver quiver) {
    var self = shot.self().withQuiver(quiver);
    var world =
        shot.world().stream().map(view -> view.id().equals(self.id()) ? self : view).toList();
    return new Shot(self, shot.enemy(), shot.decision(), world);
  }

  /** {@code shot}, at a target moving at {@code vel}. */
  private static Shot moving(Shot shot, Vec3 vel) {
    var enemy = shot.enemy().withVel(vel);
    var world =
        shot.world().stream().map(view -> view.id().equals(enemy.id()) ? enemy : view).toList();
    return new Shot(shot.self(), enemy, shot.decision(), world);
  }

  @Test
  void aLowQuiverStillTakesASettledShotInsideItsSureRange() {
    assertThat(FAR_ENEMY.distance(ARCHER_AT)).isLessThan(ArrowEconomy.sureRange(levers(1)));
    var volley =
        carrying(shot(FAR_ENEMY, List.of()), LOW)
            .run(ReflexState.initial(Facing.SOUTH), 1, 40, true);
    assertThat(volley.commands()).contains(new BodyCommand.ReleaseUse());
  }

  @Test
  void aLowQuiverHoldsAShotBeyondItsSureRangeThatAFullerOneTakes() {
    var wild = new ReflexContext(NAV.grid(), levers(0), Loadout.standard(Kit.LONGBOW));
    assertThat(FAR_ENEMY.distance(ARCHER_AT)).isGreaterThan(ArrowEconomy.sureRange(levers(0)));
    var span = new Span(1, 120);
    var low =
        carrying(shot(FAR_ENEMY, List.of()), LOW)
            .run(ReflexState.initial(Facing.SOUTH), span, true, wild);
    assertThat(low.commands())
        .contains(new BodyCommand.StartUse())
        .doesNotContain(new BodyCommand.ReleaseUse(), new BodyCommand.CancelUse());
    var fuller =
        carrying(shot(FAR_ENEMY, List.of()), Quiver.of(ArrowEconomy.CONSERVE_BELOW))
            .run(ReflexState.initial(Facing.SOUTH), span, true, wild);
    assertThat(fuller.commands()).contains(new BodyCommand.ReleaseUse());
    var endless =
        shot(FAR_ENEMY, List.of()).run(ReflexState.initial(Facing.SOUTH), span, true, wild);
    assertThat(endless.commands()).contains(new BodyCommand.ReleaseUse());
  }

  @Test
  void aLowQuiverWaitsOutAHardStrafeButNotForever() {
    var across = new Vec3(0, 0, 0.28);
    var strafing = moving(carrying(shot(FAR_ENEMY, List.of()), LOW), across);
    var waiting =
        strafing.run(ReflexState.initial(Facing.SOUTH), 1, ArrowEconomy.PATIENCE_TICKS, true);
    assertThat(waiting.commands()).doesNotContain(new BodyCommand.ReleaseUse());
    assertThat(waiting.state().isDrawing()).isTrue();
    var patient =
        strafing.run(
            waiting.state(),
            ArrowEconomy.PATIENCE_TICKS + 1,
            ArrowEconomy.PATIENCE_TICKS + 10,
            true);
    assertThat(patient.commands()).contains(new BodyCommand.ReleaseUse());
    var endless =
        moving(shot(FAR_ENEMY, List.of()), across)
            .run(ReflexState.initial(Facing.SOUTH), 1, ArrowEconomy.PATIENCE_TICKS, true);
    assertThat(endless.commands()).contains(new BodyCommand.ReleaseUse());
    var walking =
        moving(carrying(shot(FAR_ENEMY, List.of()), LOW), new Vec3(0, 0, 0.2))
            .run(ReflexState.initial(Facing.SOUTH), 1, ArrowEconomy.PATIENCE_TICKS, true);
    assertThat(walking.commands()).contains(new BodyCommand.ReleaseUse());
  }

  @Test
  void aLowQuiverTakesACloseEnemyWithTheSword() {
    var close = ARCHER_AT.plus(ArrowEconomy.CONSERVE_MELEE - 1, 0, 0);
    var low =
        carrying(shot(close, List.of()), LOW).run(ReflexState.initial(Facing.SOUTH), 1, 1, true);
    assertThat(low.commands()).doesNotContain(new BodyCommand.StartUse());
    var full = shot(close, List.of()).run(ReflexState.initial(Facing.SOUTH), 1, 1, true);
    assertThat(full.commands()).contains(new BodyCommand.StartUse());
  }

  @Test
  void onlyARunningLowFiniteQuiverConservesAndSharperAimTrustsLongerShots() {
    assertThat(ArrowEconomy.conserving(Quiver.ENDLESS)).isFalse();
    assertThat(ArrowEconomy.conserving(Quiver.of(ArrowEconomy.CONSERVE_BELOW))).isFalse();
    assertThat(ArrowEconomy.conserving(LOW)).isTrue();
    assertThat(ArrowEconomy.sureRange(levers(1))).isGreaterThan(ArrowEconomy.sureRange(levers(0)));
    assertThat(ArrowEconomy.sureRange(levers(0))).isGreaterThanOrEqualTo(ArrowEconomy.SURE_NEAR);
    assertThat(ArrowEconomy.sureRange(levers(1))).isLessThanOrEqualTo(ArrowEconomy.SURE_FAR);
  }

  @Test
  void aHolderTurnsToWatchAnEnemyFarBeyondContactRange() {
    var self = combatant(1, RED, ARCHER_AT);
    var enemy = combatant(2, BLUE, ARCHER_AT.plus(35, 0, 0));
    var decision =
        new Decision(
            self.id(),
            Option.HOLD_SLOT,
            Optional.empty(),
            List.of(),
            Stance.CAUTIOUS,
            Optional.empty(),
            Optional.of(enemy.pos()),
            Optional.empty(),
            "hold_slot:hold",
            1,
            0,
            Optional.empty());
    var toward = Facing.looking(self.eye(), enemy.pos());
    var state = ReflexState.initial(Facing.SOUTH);
    assertThat(Math.abs(state.aim().look().yawDelta(toward))).isGreaterThan(45);
    for (var tick = 1; tick <= 20; tick++) {
      var input =
          new ReflexInput(
              self,
              world(tick, List.of(self, enemy), List.of()),
              decision,
              Optional.empty(),
              0,
              List.of());
      state = Reflex.tick(state, input, context(levers(0.5)), new SplittableRandom(tick)).state();
    }
    assertThat(Math.abs(state.aim().look().yawDelta(toward))).isLessThan(5);
  }
}
