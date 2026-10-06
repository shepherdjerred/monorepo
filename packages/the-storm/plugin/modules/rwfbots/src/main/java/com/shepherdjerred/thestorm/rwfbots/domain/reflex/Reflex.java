package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
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

  /** Teammates closer than this push each other apart while fighting. */
  static final double SEPARATION = 2.5;

  /** Moving formations leave another half block for teammates closing the gap. */
  static final double WALK_SEPARATION = 3.0;

  /** The last waypoints of a path, which a bot walks straight at whoever is near. */
  static final int FINAL_STRAIGHT = 3;

  /** How hard crowding teammates bend a walking bot's heading. */
  static final double SEPARATION_WEIGHT = 1.3;

  /** A bot waits for a moving teammate with a lower id this close ahead of it. */
  static final double YIELD = 2.2;

  /** A push from teammates stronger than this means the fight is crowded. */
  static final double CROWDED = 0.3;

  /** Slower than this per tick, a teammate counts as standing. */
  static final double MOVING = 0.05;

  private static final double BOW_AIM_TOLERANCE = 2.5;
  private static final double CLICK_GAP_LOG_MEAN = 0.1;
  private static final double CLICK_GAP_LOG_SIGMA = 0.25;
  private static final double FUSE_SLIP_SCALE = 6;
  private static final double JUMP_CRIT_CHANCE = 0.15;
  private static final int JUMP_COOLDOWN = 10;
  private static final long CROUCH_BURST_TICKS = 30;
  private static final long CROUCH_TAP_TICKS = 3;

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
    var slip = meanSlip <= 0 ? 0 : -StrictMath.log(1 - random.nextDouble()) * meanSlip;
    return FUSE_BASE_GAP + (int) Math.round(slip);
  }

  /** The gap until the next melee click: never under the CPS floor, log-normally above it. */
  public static double clickGap(Levers levers, RandomGenerator random) {
    var factor = StrictMath.exp(CLICK_GAP_LOG_MEAN + CLICK_GAP_LOG_SIGMA * random.nextGaussian());
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
      crouchSpam();
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
    }

    /**
     * A crouch-spamming bot taps sneak in bursts while it stands idle, and over an enemy it has
     * just killed; otherwise it stands up unless it is sneaking on purpose.
     */
    private void crouchSpam() {
      if (!context.habits().crouchSpam()) {
        return;
      }
      var decision = input.decision();
      var killed =
          decision
              .target()
              .flatMap(input.snapshot()::combatant)
              .map(target -> !target.alive())
              .orElse(false);
      var idle =
          decision.target().isEmpty() && state.waypointIndex() >= decision.waypoints().size();
      var burst = killed || (idle && (now / CROUCH_BURST_TICKS) % 3 == 0);
      var tap = burst && (now / CROUCH_TAP_TICKS) % 2 == 0;
      var stealth = idle && decision.stance() == Stance.STEALTH;
      commands.add(new BodyCommand.Sneak(tap || stealth));
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
      var wants = health < context.habits().eatBelow() || (state.healing() && health < EAT_UNTIL);
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
      // Keep approaching the claimed slot or cover while drawing, at walking
      // speed. Route steering must not turn the bow away from its target.
      var previousAim = state.aim();
      walk(Optional.of(false));
      state = state.withAim(AimController.aim(previousAim, desired, levers(), random));
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

    /**
     * Lowers a half-drawn bow when leaving bow mode, without loosing a weak arrow that would only
     * give the bot away.
     */
    private void stopShooting() {
      if (state.isDrawing()) {
        commands.add(new BodyCommand.CancelUse());
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
      var apart = apart(SEPARATION, 0);
      var closing = closing(distance, apart);
      var move = side.plus(radial.scale(closing)).plus(apart.scale(2.5));
      var point = self.pos().plus(move.isZero() ? radial : move.normalized());
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
        if (input.decision().option() == Option.HOLD_ANGLE) {
          commands.add(new BodyCommand.Stop());
        } else {
          standApart();
        }
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
      // Near the end of the path the bot walks straight in: bending there makes it circle the spot.
      if (index < waypoints.size() - FINAL_STRAIGHT) {
        destination = bend(destination, walkingApart());
      }
      if (yields(destination)) {
        // Waiting for the teammate ahead: make room for the others while it clears.
        var push = walkingApart();
        commands.add(
            push.isZero()
                ? new BodyCommand.Stop()
                : new BodyCommand.MoveToward(self.pos().plus(push.normalized()), false));
        return;
      }
      commands.add(new BodyCommand.MoveToward(destination, sprint));
      jumpIfNeeded(waypoint);
      var ahead = destination.plus(0, CombatantView.EYE_HEIGHT, 0);
      if (!ahead.minus(self.eye()).isZero()) {
        state =
            state.withAim(
                AimController.steer(state.aim(), Facing.looking(self.eye(), ahead), levers()));
      }
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

    /**
     * How hard to close on the target: in to the strafing band, out of it when too close, and back
     * when a teammate is already on top of the fight, to give it room rather than pile in.
     */
    private static double closing(double distance, Vec3 apart) {
      if (apart.length() > CROWDED || distance < SPACING_NEAR) {
        return -0.6;
      }
      return distance > SPACING_FAR ? 1.0 : 0.0;
    }

    /**
     * A horizontal push away from teammates at their closest approach during the reaction window,
     * stronger the closer they are, so a team does not bunch up in a doorway or a brawl.
     */
    private Vec3 apart(double spacing, int aheadTicks) {
      var push = Vec3.ZERO;
      for (var other : input.snapshot().alive(self.team())) {
        if (other.id().equals(self.id())) {
          continue;
        }
        var away = self.pos().minus(other.pos()).horizontal();
        var distance = away.length();
        var relative = self.vel().minus(other.vel()).horizontal();
        var closestTick =
            relative.isZero()
                ? 0
                : Math.clamp(-away.dot(relative) / relative.lengthSquared(), 0, aheadTicks);
        var separation = away.plus(relative.scale(closestTick));
        var closest = separation.length();
        if (closest < spacing && distance > 1.0e-3) {
          var direction = separation.isZero() ? away : separation;
          push = push.plus(direction.normalized().scale((spacing - closest) / spacing));
        }
      }
      return push;
    }

    /** Leave room before converging teammates cross the spacing band during reaction delay. */
    private Vec3 walkingApart() {
      return apart(WALK_SEPARATION, levers().reactionTicks());
    }

    /** Holding a slot or drawing a bow still leaves room for crowding teammates. */
    private void standApart() {
      var push = walkingApart();
      commands.add(
          push.isZero()
              ? new BodyCommand.Stop()
              : new BodyCommand.MoveToward(self.pos().plus(push.normalized()), false));
    }

    /**
     * {@code destination} turned away from crowding teammates: the push bends the heading but never
     * stops or reverses the walk.
     */
    private Vec3 bend(Vec3 destination, Vec3 push) {
      var heading = destination.minus(self.pos()).horizontal();
      if (push.isZero() || heading.isZero()) {
        return destination;
      }
      var direction = heading.normalized().plus(push.scale(SEPARATION_WEIGHT));
      if (direction.isZero()) {
        return destination;
      }
      var length = Math.max(heading.length(), 1);
      return self.pos().plus(direction.normalized().scale(length)).withY(destination.y());
    }

    /**
     * Whether to wait a tick for a teammate just ahead walking the same way, so a team files
     * through a doorway one at a time instead of shoulder to shoulder.
     */
    private boolean yields(Vec3 destination) {
      var heading = destination.minus(self.pos()).horizontal();
      if (heading.isZero()) {
        return false;
      }
      var forward = heading.normalized();
      for (var other : input.snapshot().alive(self.team())) {
        // Only a teammate walking away the same way is followed; one standing or coming back is
        // walked round, so nobody ever waits on a bot that is waiting too.
        if (other.id().equals(self.id()) || other.vel().horizontal().dot(forward) < MOVING) {
          continue;
        }
        var toAlly = other.pos().minus(self.pos()).horizontal();
        var distance = toAlly.length();
        if (distance <= YIELD && distance > 1.0e-3 && toAlly.normalized().dot(forward) > 0.5) {
          return true;
        }
      }
      return false;
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
