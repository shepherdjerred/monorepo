package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Playbook;
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
  public static final double BOW_MIN_RANGE = 5.0;

  /**
   * A bow already drawn stays up until the target is this close, so a target hovering at the
   * minimum range does not flip the bot between drawing and swinging. A sword is a block from reach
   * here: the archer backs off drawing ({@link BowSpacing}) until then.
   */
  public static final double BOW_KEEP_RANGE = 4.0;

  /**
   * How long a drawn bow stays up, aimed where its target was, after the target leaves sight.
   * Archers used to cancel the draw the tick a target ducked behind cover or a re-plan dropped it
   * (292 of 381 production draws ended that way), so a peeking enemy was never shot.
   */
  public static final int HOLD_READY_TICKS = 40;

  /** Preferred strafing distance band. */
  public static final double SPACING_NEAR = 2.6;

  public static final double SPACING_FAR = 2.9;

  /** Ticks to hold right click for a golden apple. */
  public static final int EAT_TICKS = 32;

  /** Start eating below this effective health when safe. */
  public static final double EAT_BELOW = 10;

  /** Keep eating until effective health reaches this. */
  public static final double EAT_UNTIL = 14;

  /** How much a steak heals, at once and with no eating animation (rwf's steak). */
  public static final double STEAK_HEAL = 8;

  /** Eat a steak at or under this share of maximum health... */
  public static final double STEAK_BELOW_SHARE = 0.6;

  /** ...or this soon after being hit with an enemy at hand. */
  public static final int STEAK_AFTER_HIT_TICKS = 10;

  /** Right-clicks with steaks and kit items are at least this many ticks apart: one hand. */
  public static final int STEAK_GAP_TICKS = 4;

  /** Fuse clicks target this gap, in ticks (300 ms). */
  public static final int FUSE_BASE_GAP = 6;

  /** A fuse gap longer than this resets arming progress (750 ms). */
  public static final int FUSE_RESET_GAP = 15;

  /** How close the bot must stand to click a bomb. */
  public static final double BOMB_REACH = 3.0;

  /** Teammates closer than this push each other apart while fighting. */
  static final double SEPARATION = Playbook.SPACING;

  /** Formation steering leaves a response margin beyond the assigned playbook slots. */
  static final double WALK_SEPARATION = SEPARATION + 0.5;

  /** The last waypoints of a path, which a bot walks straight at whoever is near. */
  static final int FINAL_STRAIGHT = 3;

  /** How hard crowding teammates bend a walking bot's heading. */
  static final double SEPARATION_WEIGHT = 1.2;

  /** A push from teammates stronger than this means the fight is crowded. */
  static final double CROWDED = 0.3;

  private static final double BOW_AIM_TOLERANCE = 5.0;

  /** How much of a hurt archer's evading step goes away from its attacker; the rest goes across. */
  private static final double EVADE_AWAY = 0.6;

  private static final double CLICK_GAP_LOG_MEAN = 0.1;
  private static final double CLICK_GAP_LOG_SIGMA = 0.25;
  private static final double FUSE_SLIP_SCALE = 6;
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
    // A run-up the body did not follow this tick (it fought, ate or worked a fuse instead) is
    // abandoned: the body's run-up gate would otherwise hold every other step to the runway.
    var next = run.leapt ? run.state : unprepared(run.state);
    var commands =
        input.self().traversal().maySprint()
            ? run.commands
            : run.commands.stream()
                .map(
                    command ->
                        command instanceof BodyCommand.MoveToward(var point, var _, var hop)
                            ? new BodyCommand.MoveToward(point, false, hop)
                            : command)
                .toList();
    return new Step(next, commands);
  }

  private static ReflexState unprepared(ReflexState state) {
    return state.activeJump().filter(jump -> jump.stage() != ActiveJump.Stage.AIRBORNE).isPresent()
        ? state.withActiveJump(Optional.empty())
        : state;
  }

  /**
   * Whether the look ray from {@code self}'s eye reaches {@code target} within {@link #REACH}
   * without crossing a block.
   */
  public static boolean hitTest(
      VoxelGrid grid, CombatantView self, Facing look, CombatantView target) {
    return hitTest(grid, new AttackRay(self, look, target), Weapon.LEGACY);
  }

  private record AttackRay(CombatantView self, Facing look, CombatantView target) {}

  private static boolean hitTest(VoxelGrid grid, AttackRay ray, Weapon weapon) {
    var eye = ray.self().eye();
    var direction = ray.look().direction();
    var entry = ray.target().box().rayEntry(eye, direction);
    if (entry.isEmpty()
        || entry.getAsDouble() > weapon.maxReach()
        || entry.getAsDouble() < weapon.minReach()) {
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
    return Math.min(FUSE_RESET_GAP - 3, FUSE_BASE_GAP + (int) Math.round(slip));
  }

  /** The gap until the next melee click: never under the CPS floor, log-normally above it. */
  public static double clickGap(Levers levers, RandomGenerator random) {
    var factor = StrictMath.exp(CLICK_GAP_LOG_MEAN + CLICK_GAP_LOG_SIGMA * random.nextGaussian());
    return levers.minClickGapTicks() * Math.max(1, factor);
  }

  /** How hard a fighter circles: not at all charging, a little closing, fully in contact. */
  private static double strafeWeight(boolean charging, double distance) {
    if (charging) return 0;
    return distance > REACH + 0.5 ? 0.25 : 1.0;
  }

  /** A strafe flips its direction at random, 10 to 40 ticks apart. */
  private static ReflexState strafeFlip(ReflexState state, long now, RandomGenerator random) {
    if (now < state.nextStrafeFlip()) return state;
    var flip = random.nextBoolean() ? -state.strafeDir() : state.strafeDir();
    return state.withStrafe(flip, now + 10 + random.nextInt(30));
  }

  /** The mutable working set of one tick. */
  private static final class Run {
    private final ReflexInput input;
    private final ReflexContext context;
    private final RandomGenerator random;
    private final CombatantView self;
    private final TeamFootwork footwork;
    private final long now;
    private final List<BodyCommand> commands = new ArrayList<>();
    private ReflexState state;

    /** Whether this tick's controls followed a sprint jump, preparing or flying it. */
    private boolean leapt;

    Run(ReflexState state, ReflexInput input, ReflexContext context, RandomGenerator random) {
      this.state = state;
      this.input = input;
      this.context = context;
      this.random = random;
      this.self = input.self();
      this.footwork = new TeamFootwork(self, input.snapshot().alive(self.team()));
      this.now = input.snapshot().tick();
    }

    void execute() {
      if (!self.alive() || !input.snapshot().isLive()) {
        commands.add(new BodyCommand.Stop());
        return;
      }
      if (input.decision().routeFailure().isPresent()) {
        stopShooting();
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
      var target = input.target();
      var bomb = bombInReach();
      if (workDefuse(bomb, target)) return;
      ability();
      kitItems(false);
      act(bomb, target);
      faceThreat(target, bomb);
      steak();
      crouchSpam();
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
    }

    /**
     * Turns to an enemy in contact the bot is not fighting, seen or felt: it never keeps its back
     * to a blow, whatever path it walks. A bomb it works or a drawn bow keeps the aim.
     */
    private void faceThreat(Optional<CombatantView> target, Optional<BombView> bomb) {
      if (target.isPresent() || bomb.isPresent() || state.isDrawing()) return;
      input
          .threat()
          .ifPresent(
              at ->
                  state =
                      state.withAim(
                          AimController.aim(
                              state.aim(),
                              Facing.looking(self.eye(), at.plus(0, 1.3, 0)),
                              levers(),
                              random)));
    }

    private void act(Optional<BombView> bomb, Optional<CombatantView> target) {
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
      } else if (ReadyDraw.holds(state, input, context.loadout())) {
        ready();
      } else {
        stopShooting();
        walk(Optional.empty());
      }
    }

    private void followFirstContact() {
      commands.add(new BodyCommand.Sneak(false));
      if (self.usingItem()) commands.add(new BodyCommand.CancelUse());
      state = state.withEating(-1, false).withDrawStart(-1);
      walk(Optional.of(false));
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
    }

    private boolean workDefuse(Optional<BombView> bomb, Optional<CombatantView> target) {
      if (!defuses(bomb, target)) return false;
      if (state.isEating()) {
        commands.add(new BodyCommand.CancelUse());
        state = state.withEating(-1, false);
      }
      kitItems(true);
      fuse(bomb.orElseThrow());
      commands.add(new BodyCommand.Look(state.aim().look().yaw(), state.aim().look().pitch()));
      return true;
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

    private boolean defuses(Optional<BombView> bomb, Optional<CombatantView> target) {
      if (input.decision().option() != Option.DEFUSE || bomb.isEmpty()) return false;
      var threatened =
          com.shepherdjerred.thestorm.rwfbots.domain.tactics.ObjectivePolicy.immediateThreat(
              self, target, context.grid(), now);
      if (threatened) state = state.withNextFuseClick(now + 15);
      return !threatened;
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
     * kit's uses at least the item's gap apart; never while eating or drawing a bow. Working a
     * defuse, only cover (smoke) is put down.
     */
    private void kitItems(boolean defusing) {
      if (!state.handFreeForKit(now)) {
        return;
      }
      var means = new KitPlay.Means(Optional.of(context.grid()), KitTiming.of(levers(), random));
      for (var item : KitPlay.usable(context.loadout(), defusing)) {
        var use = KitPlay.choose(item, input, state.waypointIndex(), means);
        if (use.isPresent()) {
          commands.add(use.orElseThrow());
          state =
              state
                  .withNextKitUse(now + item.move().gapTicks())
                  .withNextRightClick(now + STEAK_GAP_TICKS);
          return;
        }
      }
    }

    /** Eats a steak when {@link SteakEating} says so, a right-click apart from kit items. */
    private void steak() {
      SteakEating.choose(context.loadout(), input, state, commands)
          .ifPresent(
              eat -> {
                commands.add(eat);
                state = state.withNextRightClick(now + STEAK_GAP_TICKS);
              });
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

    /** Whether the target is within {@code distance}, or an enemy is in contact, seen or felt. */
    private boolean enemyWithin(Optional<CombatantView> target, double distance) {
      return (target.isPresent() && target.get().pos().distance(self.pos()) <= distance)
          || input.threat().isPresent();
    }

    private void eat(Optional<CombatantView> target) {
      if (!state.isEating()) {
        stopShooting();
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
      return context.loadout().hasBow()
          && target.pos().distance(self.pos()) > ArrowEconomy.minimumRange(state, self.quiver());
    }

    private void bow(CombatantView target) {
      var distance = self.pos().horizontalDistance(target.pos());
      var speed = context.loadout().ranged().projectileSpeed();
      var flight = BowSolver.flightTicks(distance, speed);
      var aimPoint = BowSolver.lead(context.grid(), target, flight * levers().predictionQuality());
      var solved = bowFacing(aimPoint);
      if (solved.isEmpty()) {
        stopShooting();
        walk(Optional.empty());
        return;
      }
      var desired = solved.orElseThrow();
      state = state.withAim(AimController.aim(state.aim(), desired, levers(), random));
      state =
          state.withBowSight(
              Optional.of(ReadyDraw.sighted(state.bowSight(), target.id(), aimPoint, now)));
      var aim = state.aim();
      if (state.waypointIndex() < input.decision().waypoints().size()) {
        walk(Optional.of(false));
        state = state.withAim(aim);
      } else if (BowSpacing.backsOff(self, target)) {
        evade(target, BowSpacing.AWAY, BowSpacing.ACROSS);
      } else if (self.lastHurtTick() >= 0 && now - self.lastHurtTick() <= 20) {
        evade(target, EVADE_AWAY, 1);
      } else {
        standApart();
      }
      if (!state.isDrawing()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().bowSlot()));
        commands.add(new BodyCommand.StartUse());
        state = state.withDrawStart(now);
        return;
      }
      release(target, aimPoint, desired);
    }

    /**
     * Looses a full draw the arrow economy allows at {@code target} once its led arrow path to
     * {@code aimPoint} clears every teammate.
     */
    private void release(CombatantView target, Vec3 aimPoint, Facing desired) {
      var drawn = now - state.drawStart() >= context.loadout().ranged().chargeTicks();
      var aligned = state.aim().look().differenceTo(desired) <= BOW_AIM_TOLERANCE;
      if (drawn
          && ArrowEconomy.looses(state, now, new ArrowEconomy.Shot(self, target, aligned), levers())
          && !ReadyDraw.allyInLine(input.snapshot(), self, aimPoint)) {
        commands.add(new BodyCommand.ReleaseUse());
        state = state.withDrawStart(-1);
      }
    }

    private Optional<Facing> bowFacing(Vec3 point) {
      return BowSolver.facing(self.eye(), point, context.loadout().ranged().projectileSpeed());
    }

    /**
     * Keeps the drawn bow aimed where the target left sight, the corner it will most likely step
     * back out from, while the bot keeps to its path. With no target it never looses an arrow.
     */
    private void ready() {
      var point = state.bowSight().orElseThrow().point();
      var desired = bowFacing(point).orElseGet(() -> Facing.looking(self.eye(), point));
      state = state.withAim(AimController.aim(state.aim(), desired, levers(), random));
      var aim = state.aim();
      walk(Optional.of(false));
      state = state.withAim(aim);
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
      armForContact(target);
      aimMelee(target);
      var distance = self.pos().distance(target.pos());
      if (state.waypointIndex() < input.decision().waypoints().size()
          && !hitTest(
              context.grid(),
              new AttackRay(self, Facing.looking(self.eye(), target.pos().plus(0, 1.3, 0)), target),
              context.loadout().melee())) {
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
      armForContact(target);
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

    private void armForContact(CombatantView target) {
      if (self.kit().isInvisibleKit()
          && self.pos().distance(target.pos()) > context.loadout().melee().maxReach() + 0.5) {
        hideHeldItem();
      } else if (self.heldSlot() != context.loadout().swordSlot()) {
        commands.add(new BodyCommand.SelectSlot(context.loadout().swordSlot()));
      }
    }

    private void click(CombatantView target, double distance) {
      state = MeleePressure.answer(state, self, now, levers().reactionTicks());
      if (now < state.nextClickAt()) {
        return;
      }
      var landed =
          hitTest(
              context.grid(),
              new AttackRay(self, state.aim().look(), target),
              context.loadout().melee());
      // Save the next swing for contact rather than spending its cooldown during pursuit.
      if (!landed && distance > context.loadout().melee().maxReach() + 0.3) {
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
      var toTarget = target.pos().minus(self.pos()).horizontal();
      // A drawn bow is charged in legs across its line ({@link Weave}).
      var weave = !toTarget.isZero() && Weave.applies(target, distance, context.loadout().body());
      state =
          weave
              ? Weave.leg(
                  new Weave.Leg(context.grid(), input, target, levers().reactionTicks()),
                  state,
                  random)
              : strafeFlip(state, now, random);
      if (toTarget.isZero()) {
        commands.add(new BodyCommand.Stop());
        return;
      }
      var radial = toTarget.normalized();
      // Near a drop the ground picks the side to circle to and whether to back off ({@link
      // EdgeFooting}); a weave's legs already keep off drops.
      var edge = weave ? EdgeFooting.NONE : EdgeFooting.read(context.grid(), self, target, radial);
      if (edge.side() != 0) state = state.withStrafe(edge.side(), state.nextStrafeFlip());
      var side = new Vec3(-radial.z(), 0, radial.x()).scale(state.strafeDir());
      // Combat movement needs the same reaction-window personal space as formation movement.
      var apart = walkingApart();
      var closing =
          edge.closing(
              MeleePressure.closing(
                  distance, apart.length() > CROWDED, MeleePressure.yields(input), edge.ledged()));
      // Outside contact range, pursue rather than spending most acceleration circling.
      var charging = context.loadout().body() == Kit.Body.CHARGE && distance > REACH + 0.5;
      // An Inertia runs straight in: a strafe turns it and its momentum is lost.
      var strafeWeight = weave ? Weave.WEIGHT : edge.strafe(strafeWeight(charging, distance));
      var move = side.scale(strafeWeight).plus(radial.scale(closing)).plus(apart.scale(2.5));
      var preferred = move.isZero() ? radial : move.normalized();
      var alternative = radial.scale(closing < 0 ? -1 : 1);
      var safe = CombatFootwork.steer(context.grid(), self, preferred, alternative);
      // RWF's knockback counts a sprinting attacker as a knockback level: keep sprinting through
      // the strafe in the spacing band, not only while closing, so the hits there carry it.
      var sprint =
          (charging || now >= state.wTapUntil()) && CombatFootwork.sprintable(safe, radial);
      commands.add(
          safe.isZero()
              ? new BodyCommand.Stop()
              : new BodyCommand.MoveToward(self.pos().plus(safe), sprint));
      // RWF's melee rules have no airborne critical-hit bonus. Stay grounded for control;
      // navigation still jumps over terrain, and external combat actions can request a jump.
    }

    /**
     * Keeps a threatened archer moving while its aim remains on the opponent: {@code away} of each
     * step straight away from it and {@code across} of it to the side.
     */
    private void evade(CombatantView target, double away, double across) {
      var off = self.pos().minus(target.pos()).horizontal();
      if (off.isZero()) {
        commands.add(new BodyCommand.Stop());
        return;
      }
      var radial = off.normalized();
      var side = new Vec3(-radial.z(), 0, radial.x()).scale(state.strafeDir() * across);
      var move = side.plus(radial.scale(away)).plus(walkingApart());
      var preferred = move.isZero() ? radial : move.normalized();
      var safe = CombatFootwork.steer(context.grid(), self, preferred, radial);
      commands.add(
          safe.isZero()
              ? new BodyCommand.Stop()
              : new BodyCommand.MoveToward(self.pos().plus(safe), false));
    }

    /** Follows the decision's waypoints; {@code sprintOverride} forces walking when present. */
    private void walk(Optional<Boolean> sprintOverride) {
      var committed = committedJump();
      if (committed.isPresent()) {
        leap(committed.orElseThrow().waypoint());
        return;
      }
      var waypoints = input.decision().waypoints();
      // Running at a takeoff already, the body starts the leap's run-up there rather than braking
      // onto the takeoff node and walking back to the measured run-up start.
      var index =
          JumpController.joinedLeap(
              waypoints,
              activeJumpIndex(waypoints, advanceWaypoint(waypoints, state.waypointIndex())),
              self);
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
      hideHeldItem();
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
      var crowded = waypoint.hop() == Hop.WALK && footwork.allyAhead(destination);
      if (crowded) {
        sprint = false;
        destination = footwork.sidestep(destination, state.strafeDir());
      }
      // Near the end of the path the bot walks straight in: bending there makes it circle the spot.
      if (shouldBend(waypoint, index, count, destination)) {
        destination = footwork.bend(destination, walkingApart());
      }
      destination = WalkSteering.destination(context.grid(), self, waypoint, destination);
      if (waypoint.hop() == Hop.WALK && footwork.yields(destination)) {
        // Waiting for the teammate ahead: make room for the others while it clears.
        var push = walkingApart();
        commands.add(WalkSteering.makeRoom(context.grid(), self, push));
        return;
      }
      var launch = RunHop.launch(context, new RunHop.Run(input, state, index, sprint), destination);
      commands.add(new BodyCommand.MoveToward(launch.steer(), sprint, waypoint.hop()));
      launch
          .jump()
          .ifPresent(
              jump -> {
                commands.add(jump);
                state = state.withLastJump(now);
              });
      lookAhead(destination);
    }

    private boolean walksInterface(Waypoint waypoint) {
      return waypoint.hop() == Hop.SWIM
          || waypoint.hop() == Hop.CLIMB
          || (airborne() && !RunHop.ownFlight(self, now - state.lastJumpTick()));
    }

    /** Still falling: a body on solid ground has landed whatever its fall distance says. */
    private boolean airborne() {
      return self.traversal().fallDistance() > 0 && !self.onGround();
    }

    /** A certified pending first contact owns its forecast controls until actual contact. */
    private boolean ownsFirstContact() {
      var active = state.activeJump().filter(jump -> jump.stage() == ActiveJump.Stage.AIRBORNE);
      var points = input.decision().waypoints();
      if (points.isEmpty() || !airborne()) return false;
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
      leapt = true;
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
      if (self.usingItem()) {
        commands.add(new BodyCommand.CancelUse());
        // A draw lowered for the leap is over: it must not be held ready or released later.
        state = state.withDrawStart(-1);
      }
      commands.add(
          step.failed()
              ? new BodyCommand.Stop()
              : new BodyCommand.MoveToward(
                  step.moveTo(),
                  true,
                  step.state()
                          .filter(activeFlight -> activeFlight.stage() == ActiveJump.Stage.AIRBORNE)
                          .isPresent()
                      ? Hop.LEAP
                      : Hop.WALK));
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
          step.failed()
              ? new BodyCommand.Stop()
              : new BodyCommand.MoveToward(
                  step.moveTo(),
                  true,
                  step.state()
                          .filter(activeFlight -> activeFlight.stage() == ActiveJump.Stage.AIRBORNE)
                          .isPresent()
                      ? Hop.LEAP
                      : Hop.WALK));
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
      while (i < waypoints.size()
          && (WaypointArrival.reached(self, waypoints.get(i))
              || RunHop.overflown(self, waypoints, i, now - state.lastJumpTick()))) {
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

    /** Leave room before converging teammates cross the spacing band during reaction delay. */
    private Vec3 walkingApart() {
      return footwork.apart(WALK_SEPARATION, levers().reactionTicks());
    }

    /** Holding a slot or drawing a bow still leaves room for crowding teammates. */
    private void standApart() {
      var spacing =
          switch (input.decision().option()) {
            case TAKE_SLOT, HOLD_SLOT ->
                com.shepherdjerred.thestorm.rwfbots.domain.tactics.Planner.COVER_ROOM;
            default -> WALK_SEPARATION;
          };
      var push = footwork.apart(spacing, levers().reactionTicks());
      commands.add(WalkSteering.separate(context.grid(), self, push));
    }

    private void hold() {
      hideHeldItem();
      var watch = input.decision().watch();
      if (watch.isPresent()) {
        var look = Facing.looking(self.eye(), watch.get());
        state = state.withAim(AimController.steer(state.aim(), look, levers()));
      }
      if (sneaksWaiting()) {
        commands.add(new BodyCommand.Sneak(true));
      }
    }

    /** Empty hands keep an invisible traveller hidden; attacks and item uses choose their slots. */
    private void hideHeldItem() {
      if (!self.kit().isInvisibleKit() || state.isDrawing() || state.isEating()) return;
      for (var slot = 8; slot >= 0; slot--) {
        var candidate = slot;
        if (slot != context.loadout().swordSlot()
            && slot != context.loadout().bowSlot()
            && slot != context.loadout().gappleSlot()
            && slot != context.loadout().fuseSlot()
            && context.loadout().kitItems().stream().noneMatch(item -> item.slot() == candidate)) {
          if (self.heldSlot() != slot) commands.add(new BodyCommand.SelectSlot(slot));
          return;
        }
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
