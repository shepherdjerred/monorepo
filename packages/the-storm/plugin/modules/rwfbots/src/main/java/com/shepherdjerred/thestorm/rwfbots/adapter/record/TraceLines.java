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
 * </pre>
 *
 * <p>{@code features} is {@code name=quantized} pairs joined by commas, {@code utilities} is {@code
 * option=score} pairs highest first, {@code waypoints} is the path length. Numbers use the root
 * locale so lines are stable across servers.
 */
public final class TraceLines {

  public static final String KIND = "decision";

  private TraceLines() {}

  public static String decision(DecisionTrace trace, Decision decision) {
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
            Integer.toString(decision.waypoints().size()))
        + "\n";
  }

  private static String format(double value) {
    return String.format(Locale.ROOT, "%.4f", value);
  }
}
