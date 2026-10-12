package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionContract;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** Neutral original-evidence wire validated by the Java producer and TypeScript replay. */
final class SimulationContract {
  static final Spec SPEC = load();

  private SimulationContract() {}

  record Spec(
      int version,
      String contract,
      List<String> strategies,
      List<String> attackingStrategies,
      int firstSeed,
      int perTeam,
      int maximumTicks,
      long spreadTick,
      long forwardTick,
      long sampleTicks,
      double third,
      List<String> slots,
      List<String> lineup,
      Map<String, List<String>> records) {}

  private static Spec load() {
    try (var stream = SimulationContract.class.getResourceAsStream("/rwf-simulation-check.json")) {
      if (stream == null) throw new IllegalStateException("simulation capture contract missing");
      var spec = PromotionContract.JSON.readValue(stream, Spec.class);
      validate(spec);
      return spec;
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  static void validate(Spec spec) {
    if (spec.version() != 1
        || !spec.contract().equals("rwf-authored-simulation-floors-v1")
        || !spec.strategies().equals(Arrays.stream(Strategy.values()).map(Enum::name).toList())
        || !spec.attackingStrategies().equals(List.of("RUSH", "SPLIT", "HUNT")))
      throw new IllegalStateException("simulation capture differs from the fixed advancement test");
    validateMeasurements(spec);
    validateRecords(spec);
  }

  private static void validateMeasurements(Spec spec) {
    if (spec.firstSeed() != 10
        || spec.perTeam() != 8
        || spec.maximumTicks() != 900
        || spec.spreadTick() != Advance.SPREAD_TICK
        || spec.forwardTick() != Advance.BY
        || spec.sampleTicks() != Advance.SAMPLE_TICKS
        || spec.third() != Advance.THIRD)
      throw new IllegalStateException("simulation capture differs from the fixed advancement test");
    var slots =
        Stream.concat(Stream.of(""), Arrays.stream(SlotKind.values()).map(Enum::name)).toList();
    var lineup = Arenas.EIGHT.stream().map(pick -> pick.kit().name()).toList();
    if (!spec.slots().equals(slots) || !spec.lineup().equals(lineup))
      throw new IllegalStateException("simulation capture lineup or slot inventory differs");
  }

  private static void validateRecords(Spec spec) {
    var records =
        Arrays.stream(SimulationCapture.class.getDeclaredClasses())
            .filter(Class::isRecord)
            .toList();
    var inventory = java.util.Set.copyOf(records.stream().map(Class::getSimpleName).toList());
    if (!spec.records().keySet().equals(inventory))
      throw new IllegalStateException("simulation capture record inventory differs");
    for (var record : records) {
      var names =
          Arrays.stream(record.getRecordComponents())
              .map(java.lang.reflect.RecordComponent::getName)
              .toList();
      if (!names.equals(spec.records().get(record.getSimpleName())))
        throw new IllegalStateException(
            "simulation capture fields differ: " + record.getSimpleName());
    }
  }
}
