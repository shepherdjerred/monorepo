package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Conservative objective timing with a small response team and persistent work commitments. Route
 * times are the nav graph's walking-tick costs, the time a bot actually needs. A responder stuck in
 * a fight ({@link Blackboard#pinned}) yields the fuse to the next; a teammate beside a fuse being
 * defused with too few hands joins the clicking; and a fuse worker with time in hand waits near the
 * bomb for two of its retake team before walking onto the fuse alone.
 */
public final class ObjectivePolicy {
  public static final double IMMEDIATE_MELEE = 3.5;
  private static final long SOLO_WORK_TICKS = 180;
  private static final long SAFETY_TICKS = 100;

  /** A second responder starts when its own route and the work leave no more than this spare. */
  static final long BACKUP_TICKS = 200;

  /** A teammate this close to a fuse being defused joins the clicking. */
  static final double HELP_DEFUSE_RANGE = 8;

  /**
   * A defuse with this many hands on it takes no more helpers: each clicker takes a second off the
   * ten a defuse takes, and the two fuse workers and one helper still fit about the bomb.
   */
  static final int DEFUSE_STACK = 3;

  /** How close to the bomb a fuse worker waits for its retake team, and they count as there. */
  static final double STAGE_RADIUS = 16;

  /** How many of its retake team a fuse worker waits for. */
  static final int GATHER = 2;

  /** The fuse a worker keeps in hand beyond its route and the work before it stops waiting. */
  static final long GATHER_RESERVE_TICKS = 200;

  private ObjectivePolicy() {}

  record Directive(TacticalMemory memory, Optional<Option> forced) {}

  static Directive direct(TacticalMemory previous, Situation situation, TacticsContext context) {
    var threat = situation.litOwnBomb();
    if (threat.isEmpty())
      return new Directive(
          previous.objective(Optional.empty(), Optional.empty(), -1), Optional.empty());
    var bomb = threat.orElseThrow();
    var retaining = previous.defusing().filter(bomb.id()::equals).isPresent();
    if (!mayCommit(retaining, situation, context, bomb)
        || previous.excludes(bomb.pos(), situation.now()))
      return new Directive(
          previous.objective(Optional.empty(), Optional.empty(), -1), Optional.empty());
    var dangerous = threatened(situation, context);
    var safeSince = safeSince(previous, situation.now(), dangerous);
    var diversion =
        previous
            .detour()
            .flatMap(situation.snapshot()::bomb)
            .filter(target -> target.armableBy(situation.self().team()))
            .filter(target -> detourFits(situation, context, bomb, target));
    if (situation.snapshot().aliveEnemiesOf(situation.self().team()).isEmpty())
      diversion = Optional.empty();
    if (!retaining && !dangerous) diversion = detour(situation, context);
    // A detour whose approach just failed to route would be forced again every think.
    diversion =
        diversion.filter(
            target -> !previous.excludes(Planner.approach(context.nav(), target), situation.now()));
    var memory = previous.objective(Optional.of(bomb.id()), diversion.map(BombView::id), safeSince);
    if (dangerous)
      return new Directive(
          memory,
          Optional.of(
              situation.self().effectiveHealth() <= 4 || golemUpon(situation)
                  ? Option.RETREAT
                  : Option.ENGAGE));
    if (situation.now() - safeSince < TacticalMemory.RESUME_TICKS
        || (diversion.isEmpty() && gathering(situation, context, bomb)))
      return new Directive(memory, Optional.of(Option.HOLD_ANGLE));
    return new Directive(memory, Optional.of(diversion.isPresent() ? Option.ARM : Option.DEFUSE));
  }

  /**
   * Whether a fuse worker near the bomb waits for its retake team: it stands within {@link
   * #STAGE_RADIUS} but not at the fuse, nobody has started on it, fewer than {@link #GATHER} of the
   * team's retakers and screens are there, and the fuse leaves its route, the work, the safety
   * margin and {@link #GATHER_RESERVE_TICKS} to spare.
   */
  static boolean gathering(Situation situation, TacticsContext context, BombView bomb) {
    if (situation.role() != Role.RETAKE
        || !formationAssigned(situation, bomb)
        || !(bomb.state() instanceof BombState.Armed)) return false;
    var self = situation.self();
    var distance = self.pos().distance(bomb.pos());
    if (distance > STAGE_RADIUS || distance <= HELP_DEFUSE_RANGE / 2) return false;
    var plan = situation.board().plan();
    var team =
        situation.livingAllies().stream()
            .filter(
                ally ->
                    plan.slotOf(ally.id())
                        .map(slot -> slot.role() == Role.RETAKE || slot.role() == Role.DEFEND)
                        .orElse(false))
            .toList();
    var present =
        team.stream().filter(ally -> ally.pos().distance(bomb.pos()) <= STAGE_RADIUS).count();
    if (present >= Math.min(GATHER, team.size())) return false;
    return travelTicks(self, bomb, context) + workTicks(bomb) + SAFETY_TICKS + GATHER_RESERVE_TICKS
        < fuseTicks(bomb);
  }

  private static long safeSince(TacticalMemory previous, long now, boolean dangerous) {
    if (dangerous) return -1;
    // New safe work needs no recovery pause; only an interrupted commitment must settle again.
    if (previous.defusing().isEmpty()) return now - TacticalMemory.RESUME_TICKS;
    return previous.safeSince() < 0 ? now : previous.safeSince();
  }

  private static boolean mayCommit(
      boolean retaining, Situation situation, TacticsContext context, BombView bomb) {
    var keeps =
        retaining
            && !formationAssigned(situation, bomb)
            && !situation.board().pinned(situation.self().id(), situation.now());
    return keeps || responds(situation, context);
  }

  public static long fuseTicks(BombView bomb) {
    return switch (bomb.state()) {
      case BombState.Armed armed -> armed.remainingTicks();
      case BombState.Defusing working -> working.remainingTicks();
      default -> Long.MAX_VALUE;
    };
  }

  public static long workTicks(BombView bomb) {
    return bomb.state() instanceof BombState.Defusing working
        ? (long) Math.ceil(SOLO_WORK_TICKS * (1 - working.progress()))
        : SOLO_WORK_TICKS;
  }

  public static boolean immediateThreat(
      CombatantView self, Optional<CombatantView> enemy, VoxelGrid grid, long tick) {
    var melee =
        enemy
            .filter(other -> other.pos().distance(self.pos()) <= IMMEDIATE_MELEE)
            .filter(
                other -> grid.raycast(self.eye(), other.eye(), VoxelGrid.Layer.MOVEMENT).isEmpty())
            .isPresent();
    var lethal =
        self.effectiveHealth() <= 4 && self.lastHurtTick() >= 0 && tick - self.lastHurtTick() <= 20;
    return melee || lethal || grid.blocksMovement(BlockPos.of(self.pos()));
  }

  /** Whether a hostile golem stands within melee range: no fuse is worth its blows. */
  private static boolean golemUpon(Situation situation) {
    return situation
        .nearestGolem()
        .filter(golem -> golem.pos().distance(situation.self().pos()) <= IMMEDIATE_MELEE)
        .isPresent();
  }

  /** Whether a hostile summon stands within melee range of the bot. */
  private static boolean summonUpon(Situation situation) {
    return situation.percept().summons().stream()
        .anyMatch(summon -> summon.pos().distance(situation.self().pos()) <= IMMEDIATE_MELEE);
  }

  static boolean threatened(Situation situation, TacticsContext context) {
    if (summonUpon(situation)) return true;
    var enemy = situation.percept().nearestVisible();
    var clutch = situation.litOwnBomb().map(bomb -> workTicks(bomb) <= 20).orElse(false);
    var self = situation.self();
    if (clutch
        && enemy.filter(other -> other.pos().distance(self.pos()) <= IMMEDIATE_MELEE).isEmpty())
      return false;
    return immediateThreat(self, enemy, context.nav().grid(), situation.now());
  }

  /**
   * True for the team's fuse workers and helpers; without a formation, for the nearest reachable
   * responder not stuck in a fight, and a second one nearby, or once the first would be late, or
   * once its own route and the work leave no more than {@link #BACKUP_TICKS} to spare.
   */
  static boolean responds(Situation situation, TacticsContext context) {
    var bomb = situation.litOwnBomb();
    if (bomb.isEmpty()) return false;
    var target = bomb.orElseThrow();
    if (formationAssigned(situation, target))
      return situation.role() == Role.RETAKE || helpsDefuse(situation, target);
    var ordered = responders(situation, context, target);
    if (ordered.isEmpty()) return false;
    var self = situation.self();
    if (ordered.getFirst().id().equals(self.id())) return true;
    if (ordered.size() < 2
        || !ordered.get(1).id().equals(self.id())
        || situation.board().pinned(self.id(), situation.now())) return false;
    var work = workTicks(target) + SAFETY_TICKS;
    var fuse = fuseTicks(target);
    return self.pos().distance(target.pos()) <= 6
        || situation.board().pinned(ordered.getFirst().id(), situation.now())
        || travelTicks(ordered.getFirst(), target, context) + work >= fuse
        || travelTicks(self, target, context) + work + BACKUP_TICKS >= fuse;
  }

  /**
   * Whether a bot that is no fuse worker joins teammates already defusing {@code bomb}: it stands
   * within {@link #HELP_DEFUSE_RANGE}, sees no enemy, and the fuse has fewer than {@link
   * #DEFUSE_STACK} hands, or it is one of them already. Every extra clicker takes a second off the
   * defuse.
   */
  static boolean helpsDefuse(Situation situation, BombView bomb) {
    if (!(bomb.state() instanceof BombState.Defusing(var _, var clickers, var _))) return false;
    var distance = bomb.pos().distance(situation.self().eye());
    return distance <= Reflex.BOMB_REACH
        || (distance <= HELP_DEFUSE_RANGE
            && clickers < DEFUSE_STACK
            && situation.percept().nearestVisible().isEmpty());
  }

  /** Whether {@code situation}'s bot helps defuse its team's lit fuse. */
  static boolean helpsDefuse(Situation situation) {
    return situation.litOwnBomb().filter(bomb -> helpsDefuse(situation, bomb)).isPresent();
  }

  /** Responders, those stuck in a fight last, then those already working the fuse, then nearest. */
  private static List<CombatantView> responders(
      Situation situation, TacticsContext context, BombView bomb) {
    var board = situation.board();
    return situation.snapshot().alive(situation.self().team()).stream()
        .filter(
            bot ->
                board.plan().assignment().isEmpty()
                    || board.plan().assignment().containsKey(bot.id()))
        .filter(bot -> Double.isFinite(travelTicks(bot, bomb, context)))
        .sorted(
            Comparator.comparing((CombatantView bot) -> board.pinned(bot.id(), situation.now()))
                .thenComparing(bot -> !bomb.id().equals(board.workers().get(bot.id())))
                .thenComparingDouble(bot -> travelTicks(bot, bomb, context))
                .thenComparing(CombatantView::id))
        .toList();
  }

  static boolean guards(Situation situation, TacticsContext context) {
    if (situation.litOwnBomb().filter(bomb -> formationAssigned(situation, bomb)).isPresent())
      return situation.role() == Role.DEFEND && !helpsDefuse(situation);
    return situation.litOwnBomb().map(bomb -> responders(situation, context, bomb)).stream()
        .flatMap(List::stream)
        .skip(2)
        .findFirst()
        .map(bot -> bot.id().equals(situation.self().id()))
        .orElse(false);
  }

  private static boolean formationAssigned(Situation situation, BombView bomb) {
    return !situation.board().plan().assignment().isEmpty()
        && situation.board().plan().objective().filter(bomb.id()::equals).isPresent();
  }

  /**
   * A nearby plant may precede returning only when both full tasks fit, including a five-second
   * reserve.
   */
  static Optional<BombView> detour(Situation situation, TacticsContext context) {
    if (situation.snapshot().aliveEnemiesOf(situation.self().team()).isEmpty())
      return Optional.empty();
    var own = situation.litOwnBomb();
    if (own.isEmpty()) return Optional.empty();
    return situation.armableBombs().stream()
        .filter(bomb -> bomb.pos().distance(situation.self().pos()) <= 8)
        .filter(bomb -> detourFits(situation, context, own.orElseThrow(), bomb))
        .min(Comparator.comparingDouble(bomb -> bomb.pos().distance(situation.self().pos())));
  }

  private static boolean detourFits(
      Situation situation, TacticsContext context, BombView own, BombView enemy) {
    var outward = travelTicks(situation.self(), enemy, context);
    var atEnemy = situation.self().withPos(enemy.pos().plus(0, -0.5, 0));
    var returning = travelTicks(atEnemy, own, context);
    return outward + SOLO_WORK_TICKS + returning + workTicks(own) + SAFETY_TICKS <= fuseTicks(own);
  }

  /**
   * How long {@code bot} needs to reach {@code bomb}: the nav graph's path cost, which is already
   * walking time in server ticks.
   */
  private static double travelTicks(CombatantView bot, BombView bomb, TacticsContext context) {
    var nav = context.nav();
    var from = nav.graph().nearestNodeWithin(bot.pos(), 3);
    if (from.isEmpty()) return Double.POSITIVE_INFINITY;
    var site =
        nav.sites().bombs().stream()
            .filter(value -> value.cell().equals(BlockPos.of(bomb.pos())))
            .findFirst();
    if (site.isPresent()) return nav.distanceTo(site.orElseThrow().name()).at(from.getAsInt());
    var to = nav.graph().nearestNodeWithin(bomb.pos(), 3);
    if (to.isEmpty()) return Double.POSITIVE_INFINITY;
    return context
        .path(from.getAsInt(), to.getAsInt(), node -> 0)
        .map(path -> path.cost())
        .orElse(Double.POSITIVE_INFINITY);
  }
}
