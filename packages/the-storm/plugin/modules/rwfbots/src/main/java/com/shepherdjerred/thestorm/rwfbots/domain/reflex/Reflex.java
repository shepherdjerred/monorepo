package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
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

  private static final double ALLY_SPACING = 0.9;

  /** Teammates closer than this push each other apart while fighting. */
  static final double SEPARATION = 3.0;

  /** Moving formations leave another half block for teammates closing the gap. */
  static final double WALK_SEPARATION = SEPARATION + 0.5;

  /** The last waypoints of a path, which a bot walks straight at whoever is near. */
  static final int FINAL_STRAIGHT = 3;

  /** How hard crowding teammates bend a walking bot's heading. */
  static final double SEPARATION_WEIGHT = 1.2;

  /** A bot waits for a moving teammate this close ahead of it. */
  static final double YIELD = 2.2;

  /** A push from teammates stronger than this means the fight is crowded. */
  static final double CROWDED = 0.3;

  /** Slower than this per tick, a teammate counts as standing. */
  static final double MOVING = 0.05;

  private static final double BOW_AIM_TOLERANCE = 5.0;
  private static final int MAX_BOW_HOLD_TICKS = 32;
  private static final double CLICK_GAP_LOG_MEAN = 0.1;
  private static final double CLICK_GAP_LOG_SIGMA = 0.25;
  private static final double FUSE_SLIP_SCALE = 6;
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
    run.commitFlight();
    var commands =
        input.self().traversal().maySprint()
            ? run.commands
            : run.commands.stream()
                .map(
                    command ->
                        command instanceof BodyCommand.MoveToward(var point, var _)
                            ? new BodyCommand.MoveToward(point, false)
                            : command)
                .toList();
    return new Step(run.state, commands);
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
      if (ownsFirstContact()) {
        followFirstContact();
        return;
      }
      ability();
      kitItems();
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
      } else if (target.isPresent()) {
        retreat(target.orElseThrow());
      } else {
        stopShooting();
        walk(Optional.empty());
      }
      crouchSpam();
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
    }

    private void followFirstContact() {
      commands.add(new BodyCommand.Sneak(false));
      if (self.usingItem()) commands.add(new BodyCommand.CancelUse());
      state = state.withEating(-1, false).withDrawStart(-1);
      walk(Optional.of(false));
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
    }

    /**
     * A crouch-spamming bot taps sneak in bursts while it stands idle, and over an enemy it has
     * just killed; otherwise it stands up unless it is sneaking on purpose.
     */
    private void crouchSpam() {
      var decision = input.decision();
      var killed =
          context.habits().crouchSpam()
              && decision
                  .target()
                  .flatMap(input.snapshot()::combatant)
                  .map(target -> !target.alive())
                  .orElse(false);
      var idle =
          decision.target().isEmpty() && state.waypointIndex() >= decision.waypoints().size();
      var burst =
          context.habits().crouchSpam()
              && (killed || (idle && (now / CROUCH_BURST_TICKS) % 3 == 0));
      var tap = burst && (now / CROUCH_TAP_TICKS) % 2 == 0;
      var stealth = idle && sneaksWaiting();
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

    /**
     * Uses the first kit item whose moment it is ({@link KitPlay}), at most one a tick and each
     * kit's uses at least the item's gap apart; never while eating or drawing a bow.
     */
    private void kitItems() {
      if (now < state.nextKitUse() || state.isEating() || state.isDrawing()) {
        return;
      }
      for (var item : context.loadout().kitItems()) {
        var use = KitPlay.choose(item, input, state.waypointIndex());
        if (use.isPresent()) {
          commands.add(use.orElseThrow());
          state = state.withNextKitUse(now + item.move().gapTicks());
          return;
        }
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
      state = state.withAim(AimController.aim(state.aim(), desired, levers(), random));
      var aim = state.aim();
      if (state.waypointIndex() < input.decision().waypoints().size()) {
        walk(Optional.of(false));
        state = state.withAim(aim);
      } else if (self.lastHurtTick() >= 0 && now - self.lastHurtTick() <= 20) {
        evade(target);
      } else {
        standApart();
      }
      if (!state.isDrawing()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().bowSlot()));
        commands.add(new BodyCommand.StartUse());
        state = state.withDrawStart(now);
        return;
      }
      var drawn = now - state.drawStart() >= BowSolver.FULL_DRAW_TICKS;
      var aligned = state.aim().look().differenceTo(desired) <= BOW_AIM_TOLERANCE;
      var heldLongEnough = now - state.drawStart() >= MAX_BOW_HOLD_TICKS;
      if (drawn && (aligned || heldLongEnough)) {
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
      aimMelee(target);
      var distance = self.pos().distance(target.pos());
      if (state.waypointIndex() < input.decision().waypoints().size()
          && !hitTest(
              context.grid(),
              self,
              Facing.looking(self.eye(), target.pos().plus(0, 1.3, 0)),
              target)) {
        var aim = state.aim();
        walk(Optional.empty());
        state = state.withAim(aim);
        return;
      }
      click(target, distance);
      strafe(target, distance);
    }

    /** Keep the authored escape route while defending against an opponent already in contact. */
    private void retreat(CombatantView target) {
      stopShooting();
      var aim = state.aim();
      walk(Optional.empty());
      state = state.withAim(aim);
      aimMelee(target);
      if (self.heldSlot() != context.loadout().swordSlot()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().swordSlot()));
      }
      click(target, self.pos().distance(target.pos()));
    }

    private void aimMelee(CombatantView target) {
      // The oldest of N buffered facings is N-1 ticks old. Compensate relative motion.
      var lead =
          target
              .vel()
              .minus(self.vel())
              .scale((levers().reactionTicks() - 1) * levers().predictionQuality());
      var aimPoint = target.pos().plus(lead).plus(0, 1.3, 0);
      state =
          state.withAim(
              AimController.aim(
                  state.aim(), Facing.looking(self.eye(), aimPoint), levers(), random));
    }

    private void click(CombatantView target, double distance) {
      if (now < state.nextClickAt()) {
        return;
      }
      var landed = hitTest(context.grid(), self, state.aim().look(), target);
      // Save the next swing for contact rather than spending its cooldown during pursuit.
      if (!landed && distance > REACH + 0.3) {
        return;
      }
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
        commands.add(new BodyCommand.Stop());
        return;
      }
      var radial = toTarget.normalized();
      var side = new Vec3(-radial.z(), 0, radial.x()).scale(state.strafeDir());
      var apart = apart(SEPARATION, 0);
      var closing = closing(distance, apart);
      // Outside contact range, pursue rather than spending most acceleration circling.
      var charging = context.loadout().body() == Kit.Body.CHARGE && distance > REACH + 0.5;
      // An Inertia runs straight in: a strafe turns it and its momentum is lost.
      var strafeWeight = charging ? 0.0 : distance > REACH + 0.5 ? 0.25 : 1.0;
      var move = side.scale(strafeWeight).plus(radial.scale(closing)).plus(apart.scale(2.5));
      var preferred = move.isZero() ? radial : move.normalized();
      var alternative = radial.scale(closing < 0 ? -1 : 1);
      var safe = CombatFootwork.steer(context.grid(), self, preferred, alternative);
      var sprint = (charging || now >= state.wTapUntil()) && closing > 0;
      commands.add(
          safe.isZero()
              ? new BodyCommand.Stop()
              : new BodyCommand.MoveToward(self.pos().plus(safe), sprint));
      // RWF's melee rules have no airborne critical-hit bonus. Stay grounded for control;
      // navigation still jumps over terrain, and external combat actions can request a jump.
    }

    /** Keeps a threatened archer moving while its aim remains on the opponent. */
    private void evade(CombatantView target) {
      var away = self.pos().minus(target.pos()).horizontal();
      if (away.isZero()) {
        commands.add(new BodyCommand.Stop());
        return;
      }
      var radial = away.normalized();
      var side = new Vec3(-radial.z(), 0, radial.x()).scale(state.strafeDir());
      var move = side.plus(radial.scale(0.6)).plus(apart(SEPARATION, 0));
      commands.add(
          new BodyCommand.MoveToward(
              self.pos().plus(move.isZero() ? radial : move.normalized()), false));
    }

    /** Follows the decision's waypoints; {@code sprintOverride} forces walking when present. */
    private void walk(Optional<Boolean> sprintOverride) {
      var committed = committedJump();
      if (committed.isPresent()) {
        leap(committed.orElseThrow().waypoint());
        return;
      }
      var waypoints = input.decision().waypoints();
      var index = activeJumpIndex(waypoints, advanceWaypoint(waypoints, state.waypointIndex()));
      if (index != state.waypointIndex()) {
        state = state.withPath(index, input.decision().snapshotTick());
      }
      if (index >= waypoints.size()) {
        clearPreparedJump();
        if (input.decision().option() == Option.HOLD_ANGLE) {
          commands.add(new BodyCommand.Stop());
        } else {
          standApart();
        }
        hold();
        return;
      }
      var waypoint = waypoints.get(index);
      if (waypoint.hop() == Hop.LEAP) {
        leap(waypoint);
        return;
      }
      clearPreparedJump();
      walkSegment(
          waypoint, index, waypoints.size(), sprintOverride.orElseGet(this::sprintsByStance));
    }

    private Optional<ActiveJump> committedJump() {
      return state
          .activeJump()
          .filter(
              jump ->
                  jump.stage() == ActiveJump.Stage.AIRBORNE
                      || (!input.decision().waypoints().isEmpty()
                          && jump.intent().equals(jumpIntent())));
    }

    private ActiveJump.Intent jumpIntent() {
      return new ActiveJump.Intent(
          input.decision().option(), input.decision().waypoints().getLast().pos());
    }

    private void walkSegment(Waypoint waypoint, int index, int count, boolean sprint) {
      if (refusesDrop(waypoint)) return;
      var destination = interfaceDestination(waypoint);
      if (walksInterface(waypoint)) sprint = false;
      var crowded = waypoint.hop() == Hop.WALK && allyAhead(destination);
      if (crowded) {
        sprint = false;
        destination = sidestep(destination);
      }
      // Near the end of the path the bot walks straight in: bending there makes it circle the spot.
      if (shouldBend(waypoint, index, count, destination)) {
        destination = bend(destination, walkingApart());
      }
      destination = WalkSteering.destination(context.grid(), self, waypoint, destination);
      if (waypoint.hop() == Hop.WALK && yields(destination)) {
        // Waiting for the teammate ahead: make room for the others while it clears.
        var push = walkingApart();
        commands.add(WalkSteering.makeRoom(context.grid(), self, push));
        return;
      }
      commands.add(new BodyCommand.MoveToward(destination, sprint));
      jumpIfNeeded(waypoint);
      lookAhead(destination);
    }

    private boolean walksInterface(Waypoint waypoint) {
      return waypoint.hop() == Hop.SWIM
          || waypoint.hop() == Hop.CLIMB
          || self.traversal().fallDistance() > 0;
    }

    /** A certified pending first contact owns its forecast controls until actual contact. */
    private boolean ownsFirstContact() {
      var active = state.activeJump().filter(jump -> jump.stage() == ActiveJump.Stage.AIRBORNE);
      var points = input.decision().waypoints();
      if (points.isEmpty() || self.traversal().fallDistance() <= 0) return false;
      var refuge = points.getFirst();
      if ((refuge.hop() != Hop.DROP && refuge.hop() != Hop.CLIMB)
          || active.filter(jump -> compatibleLanding(jump.waypoint(), refuge)).isPresent()
          || !safePrimitive(refuge)) return false;
      state = state.withActiveJump(Optional.empty()).withPath(0, input.decision().snapshotTick());
      return true;
    }

    private static boolean compatibleLanding(Waypoint committed, Waypoint contact) {
      return committed.landing() == contact.landing()
          && Math.abs(committed.pos().y() - contact.pos().y()) <= 0.2
          && committed.pos().horizontalDistance(contact.pos()) <= 0.45;
    }

    private Vec3 interfaceDestination(Waypoint waypoint) {
      if (waypoint.hop() == Hop.SWIM
          && (waypoint.landing() == Waypoint.Landing.GROUND
              || context.grid().blocksMovement(BlockPos.of(waypoint.pos()).down()))
          && waypoint.pos().y() > self.pos().y()) return waypoint.pos().plus(0, 0.1, 0);
      return waypoint.pos();
    }

    private boolean refusesDrop(Waypoint waypoint) {
      if (waypoint.hop() != Hop.DROP || !self.onGround() || safePrimitive(waypoint)) return false;
      commands.add(new BodyCommand.Stop());
      return true;
    }

    private int activeJumpIndex(List<Waypoint> waypoints, int ordinary) {
      if (state.activeJump().isEmpty()) return ordinary;
      var active = state.activeJump().orElseThrow();
      var index = waypoints.indexOf(active.waypoint());
      return index >= 0 && !WaypointArrival.reached(self, active.waypoint()) ? index : ordinary;
    }

    private void clearPreparedJump() {
      if (state.activeJump().filter(jump -> jump.stage() != ActiveJump.Stage.AIRBORNE).isPresent())
        state = state.withActiveJump(Optional.empty());
    }

    private void leap(Waypoint waypoint) {
      if (!self.traversal().maySprint()
          && state
              .activeJump()
              .filter(jump -> jump.stage() == ActiveJump.Stage.AIRBORNE)
              .isEmpty()) {
        state = state.withActiveJump(Optional.empty());
        commands.add(new BodyCommand.Stop());
        return;
      }
      var step = JumpController.tick(state.activeJump(), jumpRequest(waypoint), self, now);
      if (step.jump() && !safePrimitive(waypoint)) {
        state = state.withActiveJump(Optional.empty());
        commands.add(new BodyCommand.Stop());
        return;
      }
      state = state.withActiveJump(step.state());
      commands.add(new BodyCommand.Sneak(false));
      if (self.usingItem()) commands.add(new BodyCommand.CancelUse());
      commands.add(
          step.failed() ? new BodyCommand.Stop() : new BodyCommand.MoveToward(step.moveTo(), true));
      if (step.jump()) {
        commands.add(new BodyCommand.Jump());
        state = state.withLastJump(now);
      }
      lookAhead(step.moveTo());
    }

    private JumpController.Request jumpRequest(Waypoint waypoint) {
      var intent =
          state
              .activeJump()
              .filter(jump -> jump.stage() == ActiveJump.Stage.AIRBORNE)
              .map(ActiveJump::intent)
              .orElseGet(this::jumpIntent);
      return new JumpController.Request(waypoint, intent);
    }

    private boolean safePrimitive(Waypoint waypoint) {
      if (waypoint.hop() == Hop.LEAP
          && FallRisk.active(self.traversal().slowFallingUntilTick(), now)) return false;
      var duration =
          waypoint
              .launch()
              .map(launch -> launch.durationTicks())
              .orElseGet(
                  () ->
                      (double)
                          TraversalCosts.drop(
                              Math.max(1, (int) Math.ceil(self.pos().y() - waypoint.pos().y()))));
      var landing =
          duration >= (double) (Long.MAX_VALUE - now - 2)
              ? Long.MAX_VALUE
              : now + (long) Math.ceil(duration) + 2;
      return FallRisk.damage(waypoint, self, landing) <= self.effectiveHealth() - 1;
    }

    private void commitFlight() {
      var active = state.activeJump().filter(jump -> jump.stage() == ActiveJump.Stage.AIRBORNE);
      if (!self.alive() || !input.snapshot().isLive() || active.isEmpty()) return;
      var jump = active.orElseThrow();
      if (jump.launchTick() == now) return;
      var step =
          JumpController.tick(
              active, new JumpController.Request(jump.waypoint(), jump.intent()), self, now);
      state = state.withActiveJump(step.state());
      if (step.state().isEmpty() && !step.failed()) return;
      commands.removeIf(
          command ->
              command instanceof BodyCommand.MoveToward
                  || command instanceof BodyCommand.Stop
                  || command instanceof BodyCommand.Jump
                  || command instanceof BodyCommand.Sneak
                  || command instanceof BodyCommand.StartUse);
      commands.add(new BodyCommand.Sneak(false));
      if (self.usingItem()) commands.add(new BodyCommand.CancelUse());
      state = state.withDrawStart(-1).withEating(-1, false);
      commands.add(
          step.failed() ? new BodyCommand.Stop() : new BodyCommand.MoveToward(step.moveTo(), true));
    }

    private void lookAhead(Vec3 destination) {
      var ahead = destination.plus(0, CombatantView.EYE_HEIGHT, 0);
      if (!ahead.minus(self.eye()).isZero()) {
        state =
            state.withAim(
                AimController.steer(state.aim(), Facing.looking(self.eye(), ahead), levers()));
      }
    }

    private boolean shouldBend(Waypoint waypoint, int index, int count, Vec3 destination) {
      return waypoint.hop() == Hop.WALK
          && (index < count - FINAL_STRAIGHT
              || self.pos().horizontalDistance(destination) > SEPARATION);
    }

    private int advanceWaypoint(List<Waypoint> waypoints, int index) {
      var i = index;
      while (i < waypoints.size() && WaypointArrival.reached(self, waypoints.get(i))) {
        i++;
      }
      return i;
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
        if (other.id().equals(self.id()) || !sharesFooting(other)) {
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
        if (other.id().equals(self.id())
            || !sharesFooting(other)
            || other.vel().horizontal().dot(forward) < MOVING) {
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
        if (other.id().equals(self.id()) || !sharesFooting(other)) {
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

    private boolean sharesFooting(CombatantView other) {
      return Math.abs(self.pos().y() - other.pos().y()) <= 1.5;
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
      if (sneaksWaiting()) {
        commands.add(new BodyCommand.Sneak(true));
      }
    }

    /**
     * Whether the bot sneaks while it stands waiting: in a stealthy stance, or as a Dwarf with no
     * enemy in sight, whose experience fills only while it sneaks.
     */
    private boolean sneaksWaiting() {
      return input.decision().stance() == Stance.STEALTH
          || (context.loadout().body() == Kit.Body.SNEAK_WHEN_IDLE && input.target().isEmpty());
    }
  }
}
