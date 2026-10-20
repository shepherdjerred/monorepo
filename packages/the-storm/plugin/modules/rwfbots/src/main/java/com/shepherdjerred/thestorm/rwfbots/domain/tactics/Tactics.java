package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.map.RouteResult;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamNote;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * The think step, run a few times a second per bot: score every option, lean the scores toward what
 * the bot's kit is for ({@link KitTactics}), favour the plan already under way, pick one through a
 * softmax at the bot's decision temperature (scaled by its archetype), keep a young plan unless
 * something urgent comes up, then expand or continue the plan into a decision for the body and a
 * note for the team.
 */
public final class Tactics {

  /** Added to the score of the option whose plan is in progress, so bots do not dither. */
  public static final double COMMIT_BONUS = 0.25;

  /** An urgent alternative must be meaningfully better to interrupt a young valid plan. */
  public static final double PREEMPT_MARGIN = 0.35;

  /** A plan younger than this is kept against anything but an urgent option, in ticks (1.5 s). */
  public static final long MIN_COMMIT_TICKS = 30;

  /** Plans older than this are dropped and rethought. */
  public static final long PLAN_TTL_TICKS = 300;

  /** Options that may cut a young plan short. */
  static final Set<Option> URGENT =
      EnumSet.of(
          Option.DEFUSE,
          Option.ESCAPE_POISON,
          Option.RETREAT,
          Option.REWIND,
          Option.HEAL,
          Option.ENGAGE,
          Option.RETAKE,
          Option.HELP_ARM);

  /** A rewind must land at least this much further from the threat than the bot stands. */
  static final double REWIND_GAIN = 5;

  private Tactics() {}

  /** Thinks once for the bot in {@code situation}. */
  public static Thought think(
      TacticsState state, Situation situation, TacticsContext context, RandomGenerator random) {
    var now = situation.now();
    var born = state.bornTick() < 0 ? now : state.bornTick();
    var clock =
        context.hasRewind() ? state.rewind().track(situation.self().pos(), now) : state.rewind();
    var rewindReady = context.hasRewind() && clock.ready(now) && landsSafer(clock, situation);
    var features =
        Features.of(situation, context, Planner.slotPoint(situation, context), rewindReady);
    var temper =
        new Utilities.Temper(
            context.style(),
            context.levers().aggression(),
            situation.role(),
            context.bias(),
            context.keep());
    var scores = Utilities.score(features, temper);
    KitTactics.lean(context.kit(), scores);
    var eliminating = situation.pendingElimination();
    objectiveScores(scores, situation, context);
    var objective = ObjectivePolicy.direct(state.memory(), situation, context);
    var current = currentPlan(state, situation, context);
    current
        .filter(Tactics::earnsCommitment)
        .ifPresent(plan -> scores.merge(plan.option(), COMMIT_BONUS, Double::sum));
    var candidates = aboveFloor(scores);
    var temperature =
        Lever.DECISION_TEMPERATURE.clamp(
            context.levers().decisionTemperature() * context.bias().temperature());
    var pick = Softmax.select(candidates, temperature, random);
    var choice = choose(pick.choice(), current, situation, scores);
    if (choice != Option.ESCAPE_POISON) choice = objective.forced().orElse(choice);
    if (eliminating && offensive(choice)) choice = Option.HOLD_ANGLE;
    if (objective.forced().isEmpty()
        && state.lifeEpoch() == 0
        && now - born < context.lateStartTicks()
        && quietStart(situation, features)) {
      choice = Option.HOLD_ANGLE;
    }
    var chosen = choice;
    // A refreshed slot plan keeps its age, so it still expires and still yields to a better pick
    // once past its commitment.
    var plan =
        current
            .filter(existing -> existing.option() == chosen)
            .map(
                existing ->
                    refresh(existing)
                        ? Planner.expand(chosen, situation, context).since(existing.startedTick())
                        : existing)
            .orElseGet(() -> Planner.expand(chosen, situation, context));
    if (chosen == Option.ARM && objective.memory().detour().isPresent()) {
      plan = Planner.detourPlan(situation, context, objective.memory().detour().orElseThrow());
    }
    var routed = route(new Planning(plan, state.lifeEpoch(), objective), situation, context);
    plan = routed.plan();
    var memory = routed.memory();
    var decision = routed.decision();
    if (decision.ability().isPresent()) {
      clock = clock.used(now);
    }
    var trace =
        new DecisionTrace(
            situation.self().id(),
            now,
            features.quantized(),
            top(scores),
            choice,
            temperature,
            pick.draw(),
            new DecisionTrace.Movement(
                situation.self().pos(),
                situation.self().traversal().fallDistance(),
                situation.self().onGround(),
                routed.failure(),
                routed.recovery()));
    return new Thought(
        new TacticsState(Optional.of(plan), now, state.lifeEpoch(), born, clock, memory),
        decision,
        trace,
        note(plan, decision, situation, context).working(memory.defusing()));
  }

  /**
   * Whether the plan under way earns {@link #COMMIT_BONUS}: not a recovery step, not an idle hold,
   * and not a fight or hunt that fell back to holding because it has no one to chase. Sticking with
   * standing still would only make a bot that drifted into it stand longer.
   */
  static boolean earnsCommitment(Plan plan) {
    return switch (plan.option()) {
      case RECOVER, HOLD_ANGLE -> false;
      case ENGAGE, HUNT -> !(plan.current() instanceof PlanStep.Hold);
      default -> true;
    };
  }

  private static boolean offensive(Option option) {
    return switch (option) {
      case ARM, HELP_ARM -> true;
      default -> false;
    };
  }

  private static Optional<Plan> currentPlan(
      TacticsState state, Situation situation, TacticsContext context) {
    return state
        .plan()
        .filter(plan -> plan.option() != Option.DEFUSE || assignedDefuser(situation))
        .map(plan -> advance(plan, situation))
        .filter(plan -> alive(plan, situation))
        .filter(plan -> Planner.coverFitsSlot(plan, situation, context))
        .filter(plan -> !situation.pendingElimination() || !offensive(plan.option()))
        .filter(
            plan ->
                plan.current()
                    .coverNode()
                    .map(node -> Planner.coverAvailable(situation, context, node))
                    .orElse(true));
  }

  private static void objectiveScores(
      Map<Option, Double> scores, Situation situation, TacticsContext context) {
    if (situation.nearestEnemy().isEmpty() && situation.sensorPosition().isPresent())
      scores.put(Option.HUNT, 0.8);
    if (situation.pendingElimination()) {
      scores.put(Option.ARM, 0.0);
      scores.put(Option.HELP_ARM, 0.0);
    }
    scores.put(Option.DEFUSE, ObjectivePolicy.responds(situation, context) ? 1.0 : 0);
    if (!assignedDefuser(situation)) scores.put(Option.DEFUSE, 0.0);
    if (situation.litOwnBomb().isPresent())
      scores.put(Option.RETAKE, ObjectivePolicy.guards(situation, context) ? 0.9 : 0);
  }

  private record Planning(Plan plan, int lifeEpoch, ObjectivePolicy.Directive objective) {}

  private record Routed(
      Plan plan,
      Decision decision,
      TacticalMemory memory,
      Optional<RouteResult.Problem> failure,
      DecisionTrace.Recovery recovery) {}

  private static Routed route(Planning planning, Situation situation, TacticsContext context) {
    var plan = planning.plan();
    var memory = planning.objective().memory();
    if (planning.objective().forced().isEmpty()
        && (plan.option() == Option.TAKE_SLOT || plan.option() == Option.HOLD_SLOT)) {
      var excluded =
          Planner.slotPoint(situation, context)
              .filter(point -> planning.objective().memory().excludes(point, situation.now()));
      if (excluded.isPresent())
        return recover(planning, situation, context, new Setback(memory, Optional.empty()));
    }
    var decision = Planner.decide(plan, situation, context, planning.lifeEpoch());
    if (decision.routeFailure().isEmpty())
      return new Routed(plan, decision, memory, Optional.empty(), DecisionTrace.Recovery.NONE);
    var failure = decision.routeFailure().orElseThrow();
    return recover(
        planning,
        situation,
        context,
        new Setback(
            memory.blocked(failure.goal(), situation.now()), Optional.of(failure.problem())));
  }

  /** Tactical memory after a route failed, and why it failed when that happened this step. */
  private record Setback(TacticalMemory memory, Optional<RouteResult.Problem> failure) {}

  /**
   * Replaces a goal the bot cannot route to: a routed step to an adjacent node, else a direct walk
   * back onto the graph, so a failed route never leaves the bot standing while any node is in
   * reach.
   */
  private static Routed recover(
      Planning planning, Situation situation, TacticsContext context, Setback setback) {
    var memory = setback.memory();
    var failure = setback.failure();
    if (RecoverySteps.strandedOnClimb(situation, context)) {
      var letGo = Planner.letGo(situation, context);
      return new Routed(
          letGo,
          Planner.decide(letGo, situation, context, planning.lifeEpoch()),
          memory,
          failure,
          DecisionTrace.Recovery.LET_GO);
    }
    var escape = RecoverySteps.escape(situation, context);
    if (escape.isPresent()) {
      var stand = Planner.letGo(situation, context);
      return new Routed(
          stand,
          Planner.decide(stand, situation, context, planning.lifeEpoch())
              .withWaypoints(escape.orElseThrow()),
          memory,
          failure,
          DecisionTrace.Recovery.ESCAPE);
    }
    var plan = Planner.recovery(situation, context);
    var decision = Planner.decide(plan, situation, context, planning.lifeEpoch());
    if (plan.current() instanceof PlanStep.Hold)
      return new Routed(plan, decision, memory, failure, DecisionTrace.Recovery.HOLD);
    if (!decision.waypoints().isEmpty() || decision.routeFailure().isEmpty())
      return new Routed(plan, decision, memory, failure, DecisionTrace.Recovery.STEP);
    var reentry = Planner.reentry(situation, context);
    if (reentry.isEmpty())
      return new Routed(plan, decision, memory, failure, DecisionTrace.Recovery.HOLD);
    var walk = new Waypoint(reentry.orElseThrow(), Hop.WALK);
    return new Routed(
        plan,
        decision.withWaypoints(List.of(walk)),
        memory,
        failure,
        DecisionTrace.Recovery.REENTER);
  }

  /** Without a team assignment anyone may save the fuse; screens yield to live fuse workers. */
  static boolean assignedDefuser(Situation situation) {
    if (situation.role() == Role.RETAKE) return true;
    var plan = situation.board().plan();
    var assignedFuse =
        plan.objective()
            .flatMap(situation.snapshot()::bomb)
            .filter(bomb -> bomb.threatens(situation.self().team()) && bomb.state().isLit());
    // A pending bounded admission is not permission for the entire screen to pile onto the fuse.
    if (!plan.assignment().isEmpty() && assignedFuse.isPresent()) return false;
    return situation.board().roles().entrySet().stream()
        .filter(entry -> entry.getValue() == Role.RETAKE)
        .noneMatch(
            entry ->
                situation
                    .snapshot()
                    .combatant(entry.getKey())
                    .map(fighter -> fighter.alive())
                    .orElse(false));
  }

  private static boolean quietStart(Situation situation, Features features) {
    var lastHurt = situation.self().lastHurtTick();
    return features.knownEnemies() == 0
        && !features.ownBombLit()
        && !features.inOwnBombPoisonZone()
        && (lastHurt < 0 || situation.now() - lastHurt > 20);
  }

  /** The softmax's pick, unless a young plan is under way and the pick is not urgent. */
  static Option choose(
      Option picked, Optional<Plan> current, Situation situation, Map<Option, Double> scores) {
    var now = situation.now();
    var escaping = current.map(plan -> plan.option() == Option.ESCAPE_POISON).orElse(false);
    if (Planner.poisonDanger(
        situation, situation.self().pos(), escaping ? Planner.POISON_MARGIN : 0)) {
      return Option.ESCAPE_POISON;
    }
    if (current.map(plan -> plan.option() == Option.TAKE_SLOT).orElse(true)
        && keepsLane(picked, situation)) {
      return Option.TAKE_SLOT;
    }
    if (current.isEmpty() || current.orElseThrow().option() == picked) {
      return picked;
    }
    var plan = current.orElseThrow();
    var combatSwitch = combatOption(picked) && combatOption(plan.option());
    if (URGENT.contains(picked) && !combatSwitch) {
      return picked;
    }
    if (URGENT.contains(picked)
        && scores.getOrDefault(picked, Utilities.FLOOR)
            > scores.getOrDefault(plan.option(), Utilities.FLOOR) + PREEMPT_MARGIN) {
      return picked;
    }
    return now - plan.startedTick() < MIN_COMMIT_TICKS ? plan.option() : picked;
  }

  /**
   * An unfinished lane, flank or sweep survives distant sightings, including gaps between bounds.
   */
  private static boolean keepsLane(Option picked, Situation situation) {
    var detour =
        picked == Option.HUNT
            || picked == Option.ENGAGE
            || picked == Option.ARM
            || picked == Option.HELP_ARM;
    var hurt =
        situation.self().lastHurtTick() >= 0
            && situation.now() - situation.self().lastHurtTick() <= 20;
    var close =
        situation.knownEnemies().stream()
            .anyMatch(
                enemy ->
                    enemy.visible()
                        && enemy.pos().distance(situation.self().pos()) <= Planner.CLOSE_FIGHT);
    return detour
        && !hurt
        && !close
        && !situation.isLastAlive()
        && situation
            .slot()
            .filter(slot -> situation.role() == Role.ROTATE || slot.kind() == SlotKind.SWEEP)
            .filter(
                slot ->
                    slot.pos().horizontalDistance(situation.self().pos()) > Features.SLOT_RADIUS)
            .isPresent();
  }

  private static boolean combatOption(Option option) {
    return option == Option.ENGAGE || option == Option.RETREAT || option == Option.HEAL;
  }

  /**
   * Whether a continuing slot plan is re-expanded anyway: routes and holds follow a slot that moves
   * (an escort's wedge, a re-deal) and switch to bounding when enemies show; a bound in progress is
   * seen through.
   */
  private static boolean refresh(Plan plan) {
    var slotPlan = plan.option() == Option.TAKE_SLOT || plan.option() == Option.HOLD_SLOT;
    return slotPlan
        && ((plan.current() instanceof PlanStep.Route route && !route.committedBound())
            || plan.current() instanceof PlanStep.Hold);
  }

  private static boolean landsSafer(RewindClock clock, Situation situation) {
    var landing = clock.landing();
    var threat = situation.nearestEnemy();
    if (landing.isEmpty() || threat.isEmpty()) {
      return false;
    }
    var enemy = threat.orElseThrow().pos();
    return landing.orElseThrow().distance(enemy)
        > situation.self().pos().distance(enemy) + REWIND_GAIN;
  }

  /** What the bot tells its team: the cover its step holds, who it fights, the path it walks. */
  private static TeamNote note(
      Plan plan, Decision decision, Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var path = new HashSet<Integer>();
    for (var waypoint : decision.waypoints()) {
      graph.nearestNode(waypoint.pos()).ifPresent(path::add);
    }
    var chasing =
        plan.current() instanceof PlanStep.Fight(var target)
            ? Optional.of(target)
            : Optional.<CombatantId>empty();
    var cover = plan.current().coverNode().or(() -> Planner.peekClaim(plan, situation, context));
    return new TeamNote(cover, chasing, path);
  }

  private static Plan advance(Plan plan, Situation situation) {
    var result = plan;
    while (!result.done() && Planner.stepDone(result.current(), situation, result.startedTick())) {
      result = result.advance();
    }
    return result;
  }

  private static boolean alive(Plan plan, Situation situation) {
    if (plan.done() || situation.now() - plan.startedTick() >= PLAN_TTL_TICKS) {
      return false;
    }
    var arm =
        plan.current() instanceof PlanStep.Arm current
            ? Optional.of(current)
            : plan.upcoming(PlanStep.Arm.class);
    if (arm.isPresent()
        && situation
            .snapshot()
            .bomb(arm.orElseThrow().bomb())
            .filter(bomb -> bomb.armableBy(situation.self().team()) && !bomb.state().isLit())
            .isEmpty()) {
      return false;
    }
    var defuse =
        plan.current() instanceof PlanStep.Defuse current
            ? Optional.of(current)
            : plan.upcoming(PlanStep.Defuse.class);
    return defuse.isEmpty()
        || situation
            .snapshot()
            .bomb(defuse.orElseThrow().bomb())
            .filter(bomb -> bomb.state().isLit())
            .isPresent();
  }

  private static Map<Option, Double> aboveFloor(EnumMap<Option, Double> scores) {
    var candidates = new EnumMap<Option, Double>(Option.class);
    scores.forEach(
        (option, score) -> {
          if (score >= Utilities.FLOOR) {
            candidates.put(option, score);
          }
        });
    if (candidates.isEmpty()) {
      candidates.put(Option.HOLD_ANGLE, Utilities.FLOOR);
    }
    return candidates;
  }

  private static java.util.List<DecisionTrace.ScoredOption> top(EnumMap<Option, Double> scores) {
    var all = new ArrayList<DecisionTrace.ScoredOption>();
    scores.forEach((option, score) -> all.add(new DecisionTrace.ScoredOption(option, score)));
    all.sort((a, b) -> Double.compare(b.score(), a.score()));
    return all.subList(0, Math.min(DecisionTrace.MAX_UTILITIES, all.size()));
  }
}
