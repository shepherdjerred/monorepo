package com.shepherdjerred.thestorm.rwfbots.adapter.record;

import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import java.util.Locale;
import java.util.stream.Collectors;

/**
 * The text form of a decision trace: one tab-separated {@code decision} line per think step.
 *
 * <pre>
 * decision  tick  bot  epoch  option  planLabel  temperature  draw  features  utilities  waypoints
 *           decided  routeFailure  recovery  x  y  z  fallDistance  onGround
 * </pre>
 *
 * <p>{@code features} is {@code name=quantized} pairs joined by commas, {@code utilities} is {@code
 * option=score} pairs highest first, {@code waypoints} is the path length. {@code option} is the
 * softmax pick; {@code decided} is the option the body follows after commitment, objectives and
 * route recovery. {@code routeFailure} is why the requested route failed this step ({@code -} when
 * it did not) and {@code recovery} what replaced it. Positions and fall distance have one decimal.
 * Numbers use the root locale so lines are stable across servers.
 */
public final class TraceLines {

  public static final String KIND = "decision";

  private TraceLines() {}

  public static String decision(DecisionTrace trace, Decision decision) {
    var movement = trace.movement();
    var features =
        trace.features().stream()
            .map(feature -> feature.name() + "=" + feature.quantized())
            .collect(Collectors.joining(","));
    var utilities =
        trace.utilities().stream()
            .map(scored -> scored.option().name() + "=" + format(scored.score()))
            .collect(Collectors.joining(","));
    return String.join(
            "\t",
            KIND,
            Long.toString(trace.snapshotTick()),
            Integer.toString(trace.bot().value()),
            Integer.toString(decision.lifeEpoch()),
            trace.choice().name(),
            decision.planLabel(),
            format(trace.temperature()),
            format(trace.randomDraw()),
            features,
            utilities,
            Integer.toString(decision.waypoints().size()),
            decision.option().name(),
            movement.routeFailure().map(Enum::name).orElse("-"),
            movement.recovery().name(),
            tenth(movement.pos().x()),
            tenth(movement.pos().y()),
            tenth(movement.pos().z()),
            tenth(movement.fallDistance()),
            Boolean.toString(movement.onGround()))
        + "\n";
  }

  private static String tenth(double value) {
    return String.format(Locale.ROOT, "%.1f", value);
  }

  private static String format(double value) {
    return String.format(Locale.ROOT, "%.4f", value);
  }
}
