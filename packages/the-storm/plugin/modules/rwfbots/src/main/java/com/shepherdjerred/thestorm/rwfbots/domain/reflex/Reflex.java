package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * The 20 Hz body controller. Each tick it picks one mode from the standing decision and what is in
 * front of it, in priority order: use an ability, eat, work the fuse, shoot, melee, or walk the
 * path. Every mode ends with a {@link BodyCommand.Look}. The controller is a pure function of its
 * state, the input, the context and the injected random source.
 */
public final class Reflex {

  /** Melee reach, blocks from the eye along the look ray. */
  public static final double REACH = 3.0;

  /** An enemy this close stops eating and starts fighting. */
  public static final double MELEE_ALERT = 4.0;

  /** Bows are used on targets further than this. */
  public static final double BOW_MIN_RANGE = 6.0;

  /** Preferred strafing distance band. */
  public static final double SPACING_NEAR = 2.6;

  public static final double SPACING_FAR = 2.9;

  /** Ticks to hold right click for a golden apple. */
  public static final int EAT_TICKS = 32;

  /** Start eating below this effective health when safe. */
  public static final double EAT_BELOW = 10;

  /** Keep eating until effective health reaches this. */
  public static final double EAT_UNTIL = 14;

  /** Fuse clicks target this gap, in ticks (300 ms). */
  public static final int FUSE_BASE_GAP = 6;

  /** A fuse gap longer than this resets arming progress (750 ms). */
  public static final int FUSE_RESET_GAP = 15;

  /** How close the bot must stand to click a bomb. */
  public static final double BOMB_REACH = 3.0;

  private static final double WAYPOINT_REACHED = 0.45;
  private static final double ALLY_SPACING = 0.9;
  private static final double BOW_AIM_TOLERANCE = 2.5;
  private static final double CLICK_GAP_LOG_MEAN = 0.1;
  private static final double CLICK_GAP_LOG_SIGMA = 0.25;
  private static final double FUSE_SLIP_SCALE = 6;
  private static final double JUMP_CRIT_CHANCE = 0.15;
  private static final int JUMP_COOLDOWN = 10;

  private Reflex() {}

  /** The outcome of one tick: the next state and the commands, in order. */
  public record Step(ReflexState state, List<BodyCommand> commands) {

    public Step {
      commands = List.copyOf(commands);
    }
  }

  /** Advances {@code state} by one tick. */
  public static Step tick(
      ReflexState state, ReflexInput input, ReflexContext context, RandomGenerator random) {
    var run = new Run(state, input, context, random);
    run.execute();
    return new Step(run.state, run.commands);
  }

  /**
   * Whether the look ray from {@code self}'s eye reaches {@code target} within {@link #REACH}
   * without crossing a block.
   */
  public static boolean hitTest(
      VoxelGrid grid, CombatantView self, Facing look, CombatantView target) {
    var eye = self.eye();
    var direction = look.direction();
    var entry = target.box().rayEntry(eye, direction);
    if (entry.isEmpty() || entry.getAsDouble() > REACH) {
      return false;
    }
    var hit = eye.plus(direction.scale(entry.getAsDouble()));
    return grid.raycast(eye, hit, VoxelGrid.Layer.MOVEMENT).isEmpty();
  }

  /**
   * The gap until the next fuse click: the base plus an exponential slip that shrinks with skill.
   */
  public static int fuseGap(Levers levers, RandomGenerator random) {
    var meanSlip = (1 - levers.technique()) * FUSE_SLIP_SCALE;
    var slip = meanSlip <= 0 ? 0 : -Math.log(1 - random.nextDouble()) * meanSlip;
    return FUSE_BASE_GAP + (int) Math.round(slip);
  }

  /** The gap until the next melee click: never under the CPS floor, log-normally above it. */
  public static double clickGap(Levers levers, RandomGenerator random) {
    var factor = Math.exp(CLICK_GAP_LOG_MEAN + CLICK_GAP_LOG_SIGMA * random.nextGaussian());
    return levers.minClickGapTicks() * Math.max(1, factor);
  }

  /** The mutable working set of one tick. */
  private static final class Run {
    private final ReflexInput input;
    private final ReflexContext context;
    private final RandomGenerator random;
    private final CombatantView self;
    private final long now;
    private final List<BodyCommand> commands = new ArrayList<>();
    private ReflexState state;

    Run(ReflexState state, ReflexInput input, ReflexContext context, RandomGenerator random) {
      this.state = state;
      this.input = input;
      this.context = context;
      this.random = random;
      this.self = input.self();
      this.now = input.snapshot().tick();
    }

    void execute() {
      if (!self.alive() || !input.snapshot().isLive()) {
        commands.add(new BodyCommand.Stop());
        return;
      }
      if (state.decisionTick() != input.decision().snapshotTick()) {
        state = state.withPath(0, input.decision().snapshotTick());
      }
      ability();
      var target = input.target();
      var bomb = bombInReach();
      if (state.isEating() || shouldStartEating(target)) {
        eat(target);
      } else if (bomb.isPresent() && !inReach(target)) {
        fuse(bomb.get());
      } else if (target.isPresent() && !avoiding() && wantsBow(target.get())) {
        bow(target.get());
      } else if (target.isPresent() && !avoiding()) {
        melee(target.get());
      } else {
        stopShooting();
        walk(Optional.empty());
      }
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
    }

    private Levers levers() {
      return context.levers();
    }

    private boolean avoiding() {
      return input.decision().stance() == Stance.EVASIVE;
    }

    private boolean inReach(Optional<CombatantView> target) {
      return target.isPresent() && target.get().pos().distance(self.pos()) <= REACH + 0.5;
    }

    private void ability() {
      var ability = input.decision().ability();
      if (ability.isPresent() && state.abilityUsedFor() != input.decision().snapshotTick()) {
        commands.add(new BodyCommand.UseAbility(ability.get()));
        state = state.withAbilityUsedFor(input.decision().snapshotTick());
      }
    }

    private Optional<BombView> bombInReach() {
      return input
          .decision()
          .bomb()
          .flatMap(id -> input.snapshot().bomb(id))
          .filter(bomb -> bomb.pos().distance(self.eye()) <= BOMB_REACH);
    }

    private boolean shouldStartEating(Optional<CombatantView> target) {
      if (!context.loadout().hasGapples() || input.gapplesLeft() <= 0) {
        return false;
      }
      var health = self.effectiveHealth();
      var wants = health < EAT_BELOW || (state.healing() && health < EAT_UNTIL);
      return wants && !enemyWithin(target, MELEE_ALERT);
    }

    private boolean enemyWithin(Optional<CombatantView> target, double distance) {
      return target.isPresent() && target.get().pos().distance(self.pos()) <= distance;
    }

    private void eat(Optional<CombatantView> target) {
      if (!state.isEating()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().gappleSlot()));
        commands.add(new BodyCommand.StartUse());
        state = state.withEating(now, true);
      } else if (enemyWithin(target, MELEE_ALERT)) {
        commands.add(new BodyCommand.ReleaseUse());
        commands.add(new BodyCommand.SelectSlot(context.loadout().swordSlot()));
        state = state.withEating(-1, false);
      } else if (now - state.eatingSince() >= EAT_TICKS) {
        commands.add(new BodyCommand.ReleaseUse());
        state = state.withEating(-1, self.effectiveHealth() < EAT_UNTIL);
      }
      walk(Optional.of(false));
    }

    private void fuse(BombView bomb) {
      stopShooting();
      commands.add(new BodyCommand.Stop());
      if (self.heldSlot() != context.loadout().fuseSlot()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().fuseSlot()));
      }
      state =
          state.withAim(
              AimController.steer(state.aim(), Facing.looking(self.eye(), bomb.pos()), levers()));
      if (now >= state.nextFuseClick()) {
        commands.add(new BodyCommand.ClickBomb(bomb.id()));
        state = state.withNextFuseClick(now + fuseGap(levers(), random));
      }
    }

    private boolean wantsBow(CombatantView target) {
      return context.loadout().hasBow() && target.pos().distance(self.pos()) > BOW_MIN_RANGE;
    }

    private void bow(CombatantView target) {
      var distance = self.pos().horizontalDistance(target.pos());
      var flight = BowSolver.flightTicks(distance, BowSolver.FULL_DRAW_SPEED);
      var lead = target.vel().scale(flight * levers().predictionQuality());
      var aimPoint = target.pos().plus(lead).plus(0, 1.3, 0);
      var pitch = BowSolver.solve(self.eye(), aimPoint, BowSolver.FULL_DRAW_SPEED);
      if (pitch.isEmpty()) {
        stopShooting();
        walk(Optional.empty());
        return;
      }
      var yaw = Facing.looking(self.eye(), aimPoint).yaw();
      var desired = new Facing(yaw, pitch.getAsDouble());
      state = state.withAim(AimController.aim(state.aim(), desired, levers(), random));
      commands.add(new BodyCommand.Stop());
      if (!state.isDrawing()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().bowSlot()));
        commands.add(new BodyCommand.StartUse());
        state = state.withDrawStart(now);
        return;
      }
      var drawn = now - state.drawStart() >= BowSolver.FULL_DRAW_TICKS;
      if (drawn && state.aim().look().differenceTo(desired) <= BOW_AIM_TOLERANCE) {
        commands.add(new BodyCommand.ReleaseUse());
        state = state.withDrawStart(-1);
      }
    }

    /** Lets go of a half-drawn bow when leaving bow mode; the arrow is wasted, not held. */
    private void stopShooting() {
      if (state.isDrawing()) {
        commands.add(new BodyCommand.ReleaseUse());
        state = state.withDrawStart(-1);
      }
    }

    private void melee(CombatantView target) {
      stopShooting();
      if (self.heldSlot() != context.loadout().swordSlot()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().swordSlot()));
      }
      var lead = target.vel().scale(levers().reactionTicks() * levers().predictionQuality());
      var aimPoint = target.pos().plus(lead).plus(0, 1.3, 0);
      state =
          state.withAim(
              AimController.aim(
                  state.aim(), Facing.looking(self.eye(), aimPoint), levers(), random));
      var distance = self.pos().distance(target.pos());
      click(target, distance);
      strafe(target, distance);
    }

    private void click(CombatantView target, double distance) {
      if (now < state.nextClickAt() || distance > REACH + 1.5) {
        return;
      }
      var landed = hitTest(context.grid(), self, state.aim().look(), target);
      commands.add(landed ? new BodyCommand.Attack(target.id()) : new BodyCommand.Swing());
      var wTap = state.wTapUntil();
      if (landed && random.nextDouble() < levers().technique()) {
        wTap = now + 1 + random.nextInt(3);
      }
      state = state.withClick(now + clickGap(levers(), random), wTap);
    }

    private void strafe(CombatantView target, double distance) {
      if (now >= state.nextStrafeFlip()) {
        var flip = random.nextBoolean() ? -state.strafeDir() : state.strafeDir();
        state = state.withStrafe(flip, now + 10 + random.nextInt(30));
      }
      var toTarget = target.pos().minus(self.pos()).horizontal();
      if (toTarget.isZero()) {
        return;
      }
      var radial = toTarget.normalized();
      var side = new Vec3(-radial.z(), 0, radial.x()).scale(state.strafeDir());
      var closing = distance > SPACING_FAR ? 1.0 : distance < SPACING_NEAR ? -0.6 : 0.0;
      var move = side.plus(radial.scale(closing));
      var point = self.pos().plus(move.normalized());
      var sprint = now >= state.wTapUntil() && closing > 0;
      commands.add(new BodyCommand.MoveToward(point, sprint));
      var critWindow = distance >= 2.5 && distance <= 3.5 && self.onGround();
      if (critWindow && random.nextDouble() < levers().technique() * JUMP_CRIT_CHANCE) {
        commands.add(new BodyCommand.Jump());
        state = state.withLastJump(now);
      }
    }

    /** Follows the decision's waypoints; {@code sprintOverride} forces walking when present. */
    private void walk(Optional<Boolean> sprintOverride) {
      var waypoints = input.decision().waypoints();
      var index = advanceWaypoint(waypoints, state.waypointIndex());
      if (index != state.waypointIndex()) {
        state = state.withPath(index, input.decision().snapshotTick());
      }
      if (index >= waypoints.size()) {
        commands.add(new BodyCommand.Stop());
        hold();
        return;
      }
      var waypoint = waypoints.get(index);
      var destination = waypoint.pos();
      var sprint = sprintOverride.orElseGet(this::sprintsByStance);
      var crowded = allyAhead(destination);
      if (crowded) {
        sprint = false;
        destination = sidestep(destination);
      }
      commands.add(new BodyCommand.MoveToward(destination, sprint));
      jumpIfNeeded(waypoint);
      var look = Facing.looking(self.eye(), destination.plus(0, CombatantView.EYE_HEIGHT, 0));
      state = state.withAim(AimController.steer(state.aim(), look, levers()));
    }

    private int advanceWaypoint(List<Waypoint> waypoints, int index) {
      var i = index;
      while (i < waypoints.size() && reached(waypoints.get(i).pos())) {
        i++;
      }
      return i;
    }

    private boolean reached(Vec3 waypoint) {
      return self.pos().horizontalDistance(waypoint) <= WAYPOINT_REACHED
          && Math.abs(self.pos().y() - waypoint.y()) < 1.2;
    }

    private boolean sprintsByStance() {
      return switch (input.decision().stance()) {
        case AGGRESSIVE, EVASIVE -> true;
        case CAUTIOUS, STEALTH -> false;
      };
    }

    private boolean allyAhead(Vec3 destination) {
      var heading = destination.minus(self.pos()).horizontal();
      if (heading.isZero()) {
        return false;
      }
      for (var other : input.snapshot().alive(self.team())) {
        if (other.id().equals(self.id())) {
          continue;
        }
        var toAlly = other.pos().minus(self.pos());
        if (toAlly.length() <= ALLY_SPACING && toAlly.dot(heading) > 0) {
          return true;
        }
      }
      return false;
    }

    private Vec3 sidestep(Vec3 destination) {
      var heading = destination.minus(self.pos()).horizontal().normalized();
      var side = new Vec3(-heading.z(), 0, heading.x()).scale(0.6 * state.strafeDir());
      return destination.plus(side);
    }

    private void jumpIfNeeded(Waypoint waypoint) {
      var needsJump =
          waypoint.hop() == Hop.JUMP
              && self.pos().horizontalDistance(waypoint.pos()) <= 1.2
              && self.onGround()
              && now - state.lastJumpTick() > JUMP_COOLDOWN;
      if (needsJump) {
        commands.add(new BodyCommand.Jump());
        state = state.withLastJump(now);
      }
    }

    private void hold() {
      var watch = input.decision().watch();
      if (watch.isPresent()) {
        var look = Facing.looking(self.eye(), watch.get());
        state = state.withAim(AimController.steer(state.aim(), look, levers()));
      }
      if (input.decision().stance() == Stance.STEALTH) {
        commands.add(new BodyCommand.Sneak(true));
      }
    }
  }
}
