package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamNote;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * The think step, run a few times a second per bot: score every option, favour the plan already
 * under way, pick one through a softmax at the bot's decision temperature (scaled by its
 * archetype), keep a young plan unless something urgent comes up, then expand or continue the plan
 * into a decision for the body and a note for the team.
 */
public final class Tactics {

  /** Added to the score of the option whose plan is in progress, so bots do not dither. */
  public static final double COMMIT_BONUS = 0.25;

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
    var current =
        state.plan().map(plan -> advance(plan, situation)).filter(plan -> alive(plan, situation));
    current.ifPresent(plan -> scores.merge(plan.option(), COMMIT_BONUS, Double::sum));
    var candidates = aboveFloor(scores);
    var temperature =
        Lever.DECISION_TEMPERATURE.clamp(
            context.levers().decisionTemperature() * context.bias().temperature());
    var pick = Softmax.select(candidates, temperature, random);
    var choice = choose(pick.choice(), current, now);
    if (context.remainingStartTicks(state, now) > 0) {
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
    var decision = Planner.decide(plan, situation, context, state.lifeEpoch());
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
            pick.draw());
    return new Thought(
        new TacticsState(Optional.of(plan), now, state.lifeEpoch(), born, clock),
        decision,
        trace,
        note(plan, decision, situation, context));
  }

  /** The softmax's pick, unless a young plan is under way and the pick is not urgent. */
  private static Option choose(Option picked, Optional<Plan> current, long now) {
    if (current.isEmpty() || current.orElseThrow().option() == picked || URGENT.contains(picked)) {
      return picked;
    }
    var plan = current.orElseThrow();
    return now - plan.startedTick() < MIN_COMMIT_TICKS ? plan.option() : picked;
  }

  /**
   * Whether a continuing slot plan is re-expanded anyway: routes and holds follow a slot that moves
   * (an escort's wedge, a re-deal) and switch to bounding when enemies show; a bound in progress is
   * seen through.
   */
  private static boolean refresh(Plan plan) {
    var slotPlan = plan.option() == Option.TAKE_SLOT || plan.option() == Option.HOLD_SLOT;
    return slotPlan
        && (plan.current() instanceof PlanStep.Route || plan.current() instanceof PlanStep.Hold);
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
    return !plan.done() && situation.now() - plan.startedTick() < PLAN_TTL_TICKS;
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
