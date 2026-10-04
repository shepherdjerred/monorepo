package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * The think step, run a few times a second per bot: score every option, favour the plan already
 * under way a little, pick one through a softmax at the bot's decision temperature, then expand or
 * continue its plan into a decision for the body.
 */
public final class Tactics {

  /** Added to the score of the option whose plan is in progress, so bots do not dither. */
  public static final double COMMIT_BONUS = 0.15;

  /** Plans older than this are dropped and rethought. */
  public static final long PLAN_TTL_TICKS = 300;

  private Tactics() {}

  /** Thinks once for the bot in {@code situation}. */
  public static Thought think(
      TacticsState state, Situation situation, TacticsContext context, RandomGenerator random) {
    var features = Features.of(situation, context);
    var temper =
        new Utilities.Temper(context.style(), context.levers().aggression(), situation.role());
    var scores = Utilities.score(features, temper);
    var current =
        state.plan().map(plan -> advance(plan, situation)).filter(plan -> alive(plan, situation));
    current.ifPresent(plan -> scores.merge(plan.option(), COMMIT_BONUS, Double::sum));
    var candidates = aboveFloor(scores);
    var temperature = context.levers().decisionTemperature();
    var pick = Softmax.select(candidates, temperature, random);
    var plan =
        current
            .filter(existing -> existing.option() == pick.choice())
            .orElseGet(() -> Planner.expand(pick.choice(), situation, context));
    var decision = Planner.decide(plan, situation, context, state.lifeEpoch());
    var trace =
        new DecisionTrace(
            situation.self().id(),
            situation.now(),
            features.quantized(),
            top(scores),
            pick.choice(),
            temperature,
            pick.draw());
    return new Thought(
        new TacticsState(Optional.of(plan), situation.now(), state.lifeEpoch()), decision, trace);
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
