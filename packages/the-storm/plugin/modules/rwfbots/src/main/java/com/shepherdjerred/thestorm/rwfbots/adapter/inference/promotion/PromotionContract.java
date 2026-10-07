package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Arrays;
import java.util.List;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.json.JsonMapper;

/** Both the runtime and producer validate the repository-owned neutral gate contract. */
public final class PromotionContract {
  public static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES)
          .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
          .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
          .build();
  private static final byte[] BYTES = bytes();
  public static final Values VALUES = load();
  public static final String SHA256 = ActorManifest.sha256(BYTES);

  private PromotionContract() {}

  public record Floors(double spacing, double width, double forward, double winding) {}

  public record SimFloors(double width, double medianWidth, double forward, double winding) {}

  public record Values(
      int version,
      String kind,
      int seeds,
      int seedSeconds,
      int matchesPerOpponent,
      int minimumAuthoredWins,
      int minimumBasicWins,
      int preferencePairs,
      int minimumLearnedVotes,
      List<Integer> parityBatches,
      int paritySteps,
      double rtol,
      double atol,
      List<Integer> loadPopulations,
      int baselineTicks,
      int liveTicks,
      int fullRosterTicks,
      double serverP95Milliseconds,
      double deadlineFraction,
      int cpus,
      String heap,
      long memoryLimitBytes,
      List<String> regressionCases,
      Floors nativeFloors,
      SimFloors simulationFloors,
      List<String> proofFields) {}

  private static byte[] bytes() {
    var stream = PromotionContract.class.getResourceAsStream("/rwf-actor-promotion.json");
    if (stream == null) throw new IllegalStateException("missing actor promotion contract");
    try (stream) {
      return stream.readAllBytes();
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static Values load() {
    var result = JSON.readValue(BYTES, Values.class);
    var fields =
        Arrays.stream(PromotionProof.class.getRecordComponents())
            .map(java.lang.reflect.RecordComponent::getName)
            .toList();
    if (result.version() != 1
        || !result.kind().equals("rwf-trooper-promotion-v1")
        || !result.proofFields().equals(fields)
        || !result
            .regressionCases()
            .equals(
                List.of(
                    "human-combat",
                    "spectator-immunity",
                    "last-human-abort",
                    "healing-and-lifecycle",
                    "native-team-advancement",
                    "native-los-and-knockback",
                    "simulation-floors"))
        || !result.nativeFloors().equals(new Floors(2.5, 16, 0.25, 2.5))
        || !result.simulationFloors().equals(new SimFloors(15, 24, 0.45, 2.5)))
      throw new IllegalStateException("unsupported actor promotion contract");
    validateQuality(result);
    validateLoad(result);
    return result;
  }

  private static void validateQuality(Values result) {
    if (result.seeds() != 3
        || result.seedSeconds() != 28800
        || result.matchesPerOpponent() != 200
        || result.minimumAuthoredWins() != 120
        || result.minimumBasicWins() != 160
        || result.preferencePairs() != 20
        || result.minimumLearnedVotes() != 15
        || !result.parityBatches().equals(List.of(1, 3, 20, 100))
        || result.paritySteps() != 16
        || result.rtol() != 1e-4
        || result.atol() != 1e-5)
      throw new IllegalStateException("unsupported actor quality gates");
  }

  private static void validateLoad(Values result) {
    if (!result.loadPopulations().equals(List.of(20, 50, 100))
        || result.baselineTicks() != 1800
        || result.liveTicks() != 3000
        || result.fullRosterTicks() != 200
        || result.serverP95Milliseconds() != 50
        || result.deadlineFraction() != 0.99
        || result.cpus() != 4
        || !result.heap().equals("8G")
        || result.memoryLimitBytes() != 10737418240L)
      throw new IllegalStateException("unsupported actor load gates");
  }
}
