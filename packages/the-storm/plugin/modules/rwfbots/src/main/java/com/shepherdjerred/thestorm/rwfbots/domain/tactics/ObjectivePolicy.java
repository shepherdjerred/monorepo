package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Conservative objective timing with a small response team and persistent work commitments. */
public final class ObjectivePolicy {
  public static final double IMMEDIATE_MELEE = 3.5;
  private static final double WALK_BLOCKS_PER_TICK = 0.18;
  private static final long SOLO_WORK_TICKS = 180;
  private static final long SAFETY_TICKS = 100;

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
          Optional.of(situation.self().effectiveHealth() <= 4 ? Option.RETREAT : Option.ENGAGE));
    if (situation.now() - safeSince < TacticalMemory.RESUME_TICKS)
      return new Directive(memory, Optional.of(Option.HOLD_ANGLE));
    return new Directive(memory, Optional.of(diversion.isPresent() ? Option.ARM : Option.DEFUSE));
  }

  private static long safeSince(TacticalMemory previous, long now, boolean dangerous) {
    if (dangerous) return -1;
    // New safe work needs no recovery pause; only an interrupted commitment must settle again.
    if (previous.defusing().isEmpty()) return now - TacticalMemory.RESUME_TICKS;
    return previous.safeSince() < 0 ? now : previous.safeSince();
  }

  private static boolean mayCommit(
      boolean retaining, Situation situation, TacticsContext context, BombView bomb) {
    return (retaining && !formationAssigned(situation, bomb)) || responds(situation, context);
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

  static boolean threatened(Situation situation, TacticsContext context) {
    var enemy = situation.percept().nearestVisible();
    var clutch = situation.litOwnBomb().map(bomb -> workTicks(bomb) <= 20).orElse(false);
    var self = situation.self();
    if (clutch
        && enemy.filter(other -> other.pos().distance(self.pos()) <= IMMEDIATE_MELEE).isEmpty())
      return false;
    return immediateThreat(self, enemy, context.nav().grid(), situation.now());
  }

  /** True only for the nearest reachable primary and a useful nearby or time-critical assistant. */
  static boolean responds(Situation situation, TacticsContext context) {
    var bomb = situation.litOwnBomb();
    if (bomb.isEmpty()) return false;
    var target = bomb.orElseThrow();
    if (formationAssigned(situation, target))
      return situation.role() == com.shepherdjerred.thestorm.rwfbots.domain.team.Role.RETAKE;
    var ordered = responders(situation, context, target);
    if (ordered.isEmpty()) return false;
    if (ordered.getFirst().id().equals(situation.self().id())) return true;
    if (ordered.size() < 2 || !ordered.get(1).id().equals(situation.self().id())) return false;
    return situation.self().pos().distance(target.pos()) <= 6
        || travelTicks(ordered.getFirst(), target, context) + workTicks(target) + SAFETY_TICKS
            >= fuseTicks(target);
  }

  private static List<CombatantView> responders(
      Situation situation, TacticsContext context, BombView bomb) {
    return situation.snapshot().alive(situation.self().team()).stream()
        .filter(
            bot ->
                situation.board().plan().assignment().isEmpty()
                    || situation.board().plan().assignment().containsKey(bot.id()))
        .filter(bot -> Double.isFinite(travelTicks(bot, bomb, context)))
        .sorted(
            Comparator.comparing(
                    (CombatantView bot) ->
                        !bomb.id().equals(situation.board().workers().get(bot.id())))
                .thenComparingDouble(bot -> travelTicks(bot, bomb, context))
                .thenComparing(CombatantView::id))
        .toList();
  }

  static boolean guards(Situation situation, TacticsContext context) {
    if (situation.litOwnBomb().filter(bomb -> formationAssigned(situation, bomb)).isPresent())
      return situation.role() == com.shepherdjerred.thestorm.rwfbots.domain.team.Role.DEFEND;
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

  private static double travelTicks(CombatantView bot, BombView bomb, TacticsContext context) {
    var nav = context.nav();
    var from = nav.graph().nearestNodeWithin(bot.pos(), 3);
    if (from.isEmpty()) return Double.POSITIVE_INFINITY;
    var site =
        nav.sites().bombs().stream()
            .filter(value -> value.cell().equals(BlockPos.of(bomb.pos())))
            .findFirst();
    if (site.isPresent())
      return nav.distanceTo(site.orElseThrow().name()).at(from.getAsInt()) / WALK_BLOCKS_PER_TICK;
    var to = nav.graph().nearestNodeWithin(bomb.pos(), 3);
    if (to.isEmpty()) return Double.POSITIVE_INFINITY;
    return context
        .path(from.getAsInt(), to.getAsInt(), node -> 0)
        .map(path -> path.cost() / WALK_BLOCKS_PER_TICK)
        .orElse(Double.POSITIVE_INFINITY);
  }
}
