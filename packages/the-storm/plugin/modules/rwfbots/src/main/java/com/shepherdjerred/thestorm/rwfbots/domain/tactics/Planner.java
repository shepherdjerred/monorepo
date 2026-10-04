package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Turns a chosen option into a short plan, knows when a step is finished, and turns the current
 * step into a {@link Decision} with a path. Routes for a team's last survivor are penalised by how
 * many regions a known enemy could watch them from, so the last man sneaks rather than runs.
 */
public final class Planner {

  /** A route step is done within this horizontal distance of its goal. */
  public static final double ROUTE_REACHED = 1.2;

  /** Fleeing is done once no known enemy is within this distance. */
  public static final double FLEE_RANGE = 12;

  /** How far away cover is looked for. */
  public static final double COVER_SEARCH = 16;

  /** Extra path cost per unit of exposure to enemy regions when sneaking. */
  public static final double STEALTH_PENALTY = 4;

  /** How far from an own bomb poison escape aims for, beyond the poison radius. */
  public static final double POISON_MARGIN = 4;

  private static final String REWIND = "rewind";

  private Planner() {}

  /** The plan carrying out {@code option} from {@code situation}. */
  public static Plan expand(Option option, Situation situation, TacticsContext context) {
    var now = situation.now();
    var stance = stanceFor(situation, context);
    return switch (option) {
      case ARM ->
          situation
              .nearestArmableBomb()
              .map(bomb -> bombPlan(option, situation, context, bomb))
              .orElseGet(() -> holdHere(option, situation, context));
      case HELP_ARM ->
          situation
              .bombBeingArmedByUs()
              .map(bomb -> bombPlan(option, situation, context, bomb))
              .orElseGet(() -> holdHere(option, situation, context));
      case DEFUSE ->
          situation
              .litOwnBomb()
              .map(bomb -> defusePlan(now, bomb, context.nav()))
              .orElseGet(() -> holdHere(option, situation, context));
      case RETAKE -> retake(situation, context);
      case ENGAGE ->
          situation
              .nearestEnemy()
              .map(enemy -> Plan.of(option, now, new PlanStep.Fight(enemy.id())))
              .orElseGet(() -> holdHere(option, situation, context));
      case RETREAT -> Plan.of(option, now, new PlanStep.Flee(safeSpot(situation, context)));
      case HEAL -> Plan.of(option, now, new PlanStep.Heal(safeSpot(situation, context)));
      case GUARD_CHOKE -> guardChoke(situation, context);
      case HOLD_ANGLE -> holdHere(option, situation, context);
      case ROTATE ->
          Plan.of(
              option, now, new PlanStep.Route(rotationPoint(situation, context), Stance.CAUTIOUS));
      case HUNT -> Plan.of(option, now, new PlanStep.Route(huntPoint(situation, context), stance));
      case ESCORT ->
          situation
              .planter()
              .map(
                  planter ->
                      Plan.of(option, now, new PlanStep.Route(planter.pos(), Stance.CAUTIOUS)))
              .orElseGet(() -> holdHere(option, situation, context));
      case ESCAPE_POISON ->
          Plan.of(option, now, new PlanStep.Route(poisonExit(situation, context), Stance.CAUTIOUS));
      case REWIND ->
          Plan.of(
              option,
              now,
              new PlanStep.Ability(REWIND),
              new PlanStep.Flee(safeSpot(situation, context)));
    };
  }

  private static Stance stanceFor(Situation situation, TacticsContext context) {
    if (situation.isLastAlive()) {
      return Stance.STEALTH;
    }
    return context.style().aggression() > 0.6 ? Stance.AGGRESSIVE : Stance.CAUTIOUS;
  }

  /** Route to the bomb and arm it; helpers walk carefully, planters at their own pace. */
  private static Plan bombPlan(
      Option option, Situation situation, TacticsContext context, BombView bomb) {
    var stance = option == Option.HELP_ARM ? Stance.CAUTIOUS : stanceFor(situation, context);
    return Plan.of(
        option,
        situation.now(),
        new PlanStep.Route(approach(context.nav(), bomb), stance),
        new PlanStep.Arm(bomb.id()));
  }

  private static Plan defusePlan(long now, BombView bomb, NavArtifact nav) {
    return Plan.of(
        Option.DEFUSE,
        now,
        new PlanStep.Route(approach(nav, bomb), Stance.AGGRESSIVE),
        new PlanStep.Defuse(bomb.id()));
  }

  private static Plan retake(Situation situation, TacticsContext context) {
    var bomb = situation.nearestOwnBomb();
    if (bomb.isEmpty()) {
      return holdHere(Option.RETAKE, situation, context);
    }
    var at = approach(context.nav(), bomb.get());
    var watch =
        situation.nearestEnemy().map(Situation.KnownEnemy::pos).orElseGet(() -> at.plus(1, 0, 0));
    return Plan.of(
        Option.RETAKE,
        situation.now(),
        new PlanStep.Route(at, Stance.AGGRESSIVE),
        new PlanStep.Hold(at, watch, Stance.AGGRESSIVE));
  }

  private static Plan guardChoke(Situation situation, TacticsContext context) {
    var nav = context.nav();
    var bomb = situation.nearestOwnBomb();
    var points = nav.chokepoints().points();
    if (bomb.isEmpty() || points.isEmpty()) {
      return holdHere(Option.GUARD_CHOKE, situation, context);
    }
    var anchor = bomb.get().pos();
    var choke =
        points.stream()
            .min(
                (a, b) ->
                    Double.compare(
                        nav.graph().feet(a.node()).distance(anchor),
                        nav.graph().feet(b.node()).distance(anchor)))
            .orElseThrow();
    var at = nav.graph().feet(choke.node());
    var watch = enemySpawn(situation, context).orElseGet(() -> at.plus(anchor.minus(at).scale(-1)));
    return Plan.of(
        Option.GUARD_CHOKE,
        situation.now(),
        new PlanStep.Route(at, Stance.CAUTIOUS),
        new PlanStep.Hold(at, watch, Stance.CAUTIOUS));
  }

  private static Plan holdHere(Option option, Situation situation, TacticsContext context) {
    var self = situation.self();
    var watch =
        situation
            .nearestEnemy()
            .map(Situation.KnownEnemy::pos)
            .or(() -> enemySpawn(situation, context))
            .orElseGet(() -> self.pos().plus(self.facing().direction().scale(8)));
    var stance = situation.isLastAlive() ? Stance.STEALTH : Stance.CAUTIOUS;
    return Plan.of(option, situation.now(), new PlanStep.Hold(self.pos(), watch, stance));
  }

  /** Cover that hides from the nearest enemy, else the own spawn, else where the bot stands. */
  private static Vec3 safeSpot(Situation situation, TacticsContext context) {
    var nav = context.nav();
    var self = situation.self();
    var threat = situation.nearestEnemy().map(Situation.KnownEnemy::pos);
    if (threat.isPresent()) {
      for (var point :
          nav.cover().protectingFrom(nav.graph(), self.pos(), threat.get(), COVER_SEARCH)) {
        var feet = nav.graph().feet(point.node());
        var awayFromThreat = feet.distance(threat.get()) > self.pos().distance(threat.get()) - 1;
        if (awayFromThreat && !situation.board().isCoverClaimed(point.node(), self.id())) {
          return feet;
        }
      }
    }
    return ownSpawn(situation, context).orElseGet(self::pos);
  }

  private static Vec3 rotationPoint(Situation situation, TacticsContext context) {
    var self = situation.self();
    var bombs = situation.snapshot().bombs();
    return bombs.stream()
        .map(bomb -> approach(context.nav(), bomb))
        .max((a, b) -> Double.compare(a.distance(self.pos()), b.distance(self.pos())))
        .orElseGet(self::pos);
  }

  private static Vec3 huntPoint(Situation situation, TacticsContext context) {
    return situation
        .nearestEnemy()
        .map(Situation.KnownEnemy::pos)
        .or(() -> enemySpawn(situation, context))
        .orElseGet(() -> situation.self().pos());
  }

  /** Away from the own bomb: towards the nearest armable bomb, else the enemy spawn. */
  private static Vec3 poisonExit(Situation situation, TacticsContext context) {
    var self = situation.self();
    var radius = situation.snapshot().poison().bombRadius() + POISON_MARGIN;
    var goal =
        situation
            .nearestArmableBomb()
            .map(bomb -> approach(context.nav(), bomb))
            .or(() -> enemySpawn(situation, context))
            .orElseGet(self::pos);
    var ownBomb = situation.nearestOwnBomb().map(BombView::pos);
    if (ownBomb.isEmpty() || goal.distance(ownBomb.get()) > radius) {
      return goal;
    }
    var away = goal.minus(ownBomb.get()).horizontal();
    var direction = away.isZero() ? new Vec3(1, 0, 0) : away.normalized();
    return ownBomb.get().plus(direction.scale(radius)).withY(self.pos().y());
  }

  private static Vec3 approach(NavArtifact nav, BombView bomb) {
    var node = nav.graph().nearestNode(bomb.pos().plus(0, -0.5, 0));
    return node.isPresent() ? nav.graph().feet(node.getAsInt()) : bomb.pos();
  }

  private static Optional<Vec3> enemySpawn(Situation situation, TacticsContext context) {
    return spawnWhere(
        context.nav(), site -> !site.team().orElse("").equals(situation.self().team().value()));
  }

  private static Optional<Vec3> ownSpawn(Situation situation, TacticsContext context) {
    return spawnWhere(
        context.nav(), site -> site.team().orElse("").equals(situation.self().team().value()));
  }

  private static Optional<Vec3> spawnWhere(
      NavArtifact nav, java.util.function.Predicate<NavSites.Site> filter) {
    return nav.sites().spawns().stream()
        .filter(filter)
        .map(site -> nav.approachNode(site))
        .filter(node -> node.isPresent())
        .map(node -> nav.graph().feet(node.getAsInt()))
        .findFirst();
  }

  /** Whether {@code step} has achieved its purpose in {@code situation}. */
  public static boolean stepDone(PlanStep step, Situation situation, long startedTick) {
    var self = situation.self();
    return switch (step) {
      case PlanStep.Route(var goal, var _) -> reached(self.pos(), goal);
      case PlanStep.Fight(var target) ->
          situation.knownEnemies().stream().noneMatch(enemy -> enemy.id().equals(target));
      case PlanStep.Arm(var bomb) ->
          situation
              .snapshot()
              .bomb(bomb)
              .map(view -> !view.armableBy(self.team()) || view.state().isLit())
              .orElse(true);
      case PlanStep.Defuse(var bomb) ->
          situation.snapshot().bomb(bomb).map(view -> !view.state().isLit()).orElse(true);
      case PlanStep.Hold _ -> false;
      case PlanStep.Heal _ -> self.effectiveHealth() >= Reflex.EAT_UNTIL;
      case PlanStep.Flee(var goal) ->
          reached(self.pos(), goal)
              || situation
                  .nearestEnemy()
                  .map(enemy -> enemy.pos().distance(self.pos()) > FLEE_RANGE)
                  .orElse(true);
      case PlanStep.Ability _ -> situation.now() > startedTick;
    };
  }

  private static boolean reached(Vec3 pos, Vec3 goal) {
    return pos.horizontalDistance(goal) <= ROUTE_REACHED && Math.abs(pos.y() - goal.y()) < 1.5;
  }

  /** The decision carrying out the current step of {@code plan}. */
  public static Decision decide(
      Plan plan, Situation situation, TacticsContext context, int lifeEpoch) {
    var self = situation.self();
    var scene = new Scene(situation, context, lifeEpoch);
    var label =
        plan.option().name().toLowerCase(java.util.Locale.ROOT) + ":" + plan.current().label();
    var nearestVisible = situation.percept().nearestVisible().map(view -> view.id());
    var nextBomb =
        plan.upcoming(PlanStep.Arm.class)
            .map(PlanStep.Arm::bomb)
            .or(() -> plan.upcoming(PlanStep.Defuse.class).map(PlanStep.Defuse::bomb));
    return switch (plan.current()) {
      case PlanStep.Route(var goal, var stance) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  stance == Stance.STEALTH ? Optional.empty() : nearestVisible,
                  pathTo(situation, context, goal, stance),
                  stance,
                  nextBomb,
                  Optional.empty(),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Fight(var target) -> fight(plan, scene, target);
      case PlanStep.Arm(var bomb) -> atBomb(plan, scene, bomb);
      case PlanStep.Defuse(var bomb) -> atBomb(plan, scene, bomb);
      case PlanStep.Hold(var pos, var watch, var stance) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  nearestVisible,
                  reached(self.pos(), pos) ? List.of() : pathTo(situation, context, pos, stance),
                  stance,
                  Optional.empty(),
                  Optional.of(watch),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Heal(var cover) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  nearestVisible,
                  reached(self.pos(), cover)
                      ? List.of()
                      : pathTo(situation, context, cover, Stance.CAUTIOUS),
                  Stance.CAUTIOUS,
                  Optional.empty(),
                  Optional.empty(),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Flee(var goal) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  Optional.empty(),
                  pathTo(situation, context, goal, Stance.EVASIVE),
                  Stance.EVASIVE,
                  Optional.empty(),
                  Optional.empty(),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Ability(var name) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  Optional.empty(),
                  List.of(),
                  Stance.EVASIVE,
                  Optional.empty(),
                  Optional.empty(),
                  Optional.of(name),
                  label),
              lifeEpoch);
    };
  }

  /** The variable parts of a decision. */
  private record Parts(
      Option option,
      Optional<CombatantId> target,
      List<Waypoint> waypoints,
      Stance stance,
      Optional<BombId> bomb,
      Optional<Vec3> watch,
      Optional<String> ability,
      String label) {}

  private static Decision decision(Situation situation, Parts parts, int lifeEpoch) {
    return new Decision(
        situation.self().id(),
        parts.option(),
        parts.target(),
        parts.waypoints(),
        parts.stance(),
        parts.bomb(),
        parts.watch(),
        parts.ability(),
        parts.label(),
        situation.now(),
        lifeEpoch);
  }

  /** Who is deciding, with what, for which life. */
  private record Scene(Situation situation, TacticsContext context, int lifeEpoch) {}

  private static Decision fight(Plan plan, Scene scene, CombatantId target) {
    var situation = scene.situation();
    var context = scene.context();
    var lifeEpoch = scene.lifeEpoch();
    var known =
        situation.knownEnemies().stream().filter(enemy -> enemy.id().equals(target)).findFirst();
    var waypoints =
        known.isPresent() && !known.get().visible()
            ? pathTo(situation, context, known.get().pos(), Stance.AGGRESSIVE)
            : List.<Waypoint>of();
    return decision(
        situation,
        new Parts(
            plan.option(),
            Optional.of(target),
            waypoints,
            Stance.AGGRESSIVE,
            Optional.empty(),
            known.map(Situation.KnownEnemy::pos),
            Optional.empty(),
            plan.option().name().toLowerCase(java.util.Locale.ROOT) + ":fight"),
        lifeEpoch);
  }

  private static Decision atBomb(Plan plan, Scene scene, BombId bomb) {
    var situation = scene.situation();
    var context = scene.context();
    var lifeEpoch = scene.lifeEpoch();
    var view = situation.snapshot().bomb(bomb);
    var label =
        plan.option().name().toLowerCase(java.util.Locale.ROOT) + ":" + plan.current().label();
    var waypoints =
        view.filter(b -> b.pos().distance(situation.self().eye()) > Reflex.BOMB_REACH - 0.5)
            .map(b -> pathTo(situation, context, approach(context.nav(), b), Stance.CAUTIOUS))
            .orElseGet(List::of);
    return decision(
        situation,
        new Parts(
            plan.option(),
            situation.percept().nearestVisible().map(v -> v.id()),
            waypoints,
            Stance.CAUTIOUS,
            Optional.of(bomb),
            view.map(BombView::pos),
            Optional.empty(),
            label),
        lifeEpoch);
  }

  /** The waypoints from the bot to {@code goal}; empty when there is no path. */
  static List<Waypoint> pathTo(
      Situation situation, TacticsContext context, Vec3 goal, Stance stance) {
    var graph = context.nav().graph();
    var from = graph.nearestNode(situation.self().pos());
    var to = graph.nearestNode(goal);
    if (from.isEmpty() || to.isEmpty()) {
      return List.of();
    }
    var path =
        stance == Stance.STEALTH
            ? graph.path(from.getAsInt(), to.getAsInt(), stealthPenalty(situation, context))
            : graph.path(from.getAsInt(), to.getAsInt());
    return path.map(found -> found.toFollow()).orElseGet(List::of);
  }

  private static java.util.function.IntToDoubleFunction stealthPenalty(
      Situation situation, TacticsContext context) {
    var nav = context.nav();
    var regions = nav.regions();
    Set<Integer> watchers = new HashSet<>();
    for (var enemy : situation.knownEnemies()) {
      nav.graph().nearestNode(enemy.pos()).ifPresent(node -> watchers.add(regions.regionOf(node)));
    }
    for (var site : nav.sites().spawns()) {
      if (!site.team().orElse("").equals(situation.self().team().value())) {
        nav.approachNode(site).ifPresent(node -> watchers.add(regions.regionOf(node)));
      }
    }
    return node -> STEALTH_PENALTY * regions.exposure(regions.regionOf(node), watchers);
  }

  /** Whether a bomb is still worth the plan it anchors. */
  static boolean bombStillRelevant(Optional<BombView> bomb) {
    return bomb.isPresent() && !(bomb.get().state() instanceof BombState.Destroyed);
  }
}
