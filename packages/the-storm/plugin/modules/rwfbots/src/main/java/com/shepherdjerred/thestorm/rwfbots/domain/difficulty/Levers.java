package com.shepherdjerred.thestorm.rwfbots.domain.difficulty;

import java.util.EnumMap;
import java.util.Map;

/**
 * A full set of lever values for one bot in one match. Every value is inside its lever's range.
 *
 * @param reactionMs reaction delay in milliseconds, 150..450
 * @param aimErrorDeg aim error standard deviation in degrees, 0.5..6
 * @param turnRateDegPerTick the most the view turns per tick, 8..45
 * @param cps melee clicks per second, 5..12
 * @param predictionQuality motion prediction, 0..1
 * @param decisionTemperature softmax temperature, 0.05..1
 * @param awarenessRadius notice distance in blocks, 24..64
 * @param coordination teammate information sharing, 0..1
 * @param technique mechanical polish, 0..1
 * @param aggression willingness to fight, 0..1
 */
public record Levers(
    double reactionMs,
    double aimErrorDeg,
    double turnRateDegPerTick,
    double cps,
    double predictionQuality,
    double decisionTemperature,
    double awarenessRadius,
    double coordination,
    double technique,
    double aggression) {

  /** Milliseconds per server tick. */
  public static final double MS_PER_TICK = 50;

  public Levers {
    Lever.REACTION_MS.check(reactionMs);
    Lever.AIM_ERROR_DEG.check(aimErrorDeg);
    Lever.TURN_RATE_DEG_PER_TICK.check(turnRateDegPerTick);
    Lever.CPS.check(cps);
    Lever.PREDICTION_QUALITY.check(predictionQuality);
    Lever.DECISION_TEMPERATURE.check(decisionTemperature);
    Lever.AWARENESS_RADIUS.check(awarenessRadius);
    Lever.COORDINATION.check(coordination);
    Lever.TECHNIQUE.check(technique);
    Lever.AGGRESSION.check(aggression);
  }

  /** Levers from a complete map; a missing lever is an error. */
  public static Levers of(Map<Lever, Double> values) {
    return new Levers(
        require(values, Lever.REACTION_MS),
        require(values, Lever.AIM_ERROR_DEG),
        require(values, Lever.TURN_RATE_DEG_PER_TICK),
        require(values, Lever.CPS),
        require(values, Lever.PREDICTION_QUALITY),
        require(values, Lever.DECISION_TEMPERATURE),
        require(values, Lever.AWARENESS_RADIUS),
        require(values, Lever.COORDINATION),
        require(values, Lever.TECHNIQUE),
        require(values, Lever.AGGRESSION));
  }

  private static double require(Map<Lever, Double> values, Lever lever) {
    var value = values.get(lever);
    if (value == null) {
      throw new IllegalArgumentException("missing lever: " + lever.key());
    }
    return value;
  }

  public double get(Lever lever) {
    return switch (lever) {
      case REACTION_MS -> reactionMs;
      case AIM_ERROR_DEG -> aimErrorDeg;
      case TURN_RATE_DEG_PER_TICK -> turnRateDegPerTick;
      case CPS -> cps;
      case PREDICTION_QUALITY -> predictionQuality;
      case DECISION_TEMPERATURE -> decisionTemperature;
      case AWARENESS_RADIUS -> awarenessRadius;
      case COORDINATION -> coordination;
      case TECHNIQUE -> technique;
      case AGGRESSION -> aggression;
    };
  }

  public Map<Lever, Double> asMap() {
    var map = new EnumMap<Lever, Double>(Lever.class);
    for (var lever : Lever.values()) {
      map.put(lever, get(lever));
    }
    return map;
  }

  /** The reaction delay in whole ticks, at least one. */
  public int reactionTicks() {
    return Math.max(1, (int) Math.round(reactionMs / MS_PER_TICK));
  }

  /** The shortest allowed gap between melee clicks, in ticks (fractional). */
  public double minClickGapTicks() {
    return 20.0 / cps;
  }

  public Levers with(Lever lever, double value) {
    var map = asMap();
    map.put(lever, lever.check(value));
    return of(map);
  }
}
