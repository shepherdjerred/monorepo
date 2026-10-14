package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Language-neutral contract for controlled joined-member diagnostics, never human training. */
record HealthProtocol(
    int version,
    String kind,
    boolean humanDemonstration,
    Environment environment,
    int maximumTicks,
    Map<String, List<String>> records,
    List<Scenario> scenarios) {
  static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .build();

  record Scenario(String id, String kit, String landing, String mode, int maximumDrops) {}

  record Environment(String difficulty, int foodLevel, double saturation) {}

  record Sample(
      long sequence,
      int serverTick,
      UUID match,
      UUID body,
      UUID world,
      String kit,
      boolean alive,
      double health,
      double absorption,
      double maxHealth,
      long lastHurtTick,
      List<Double> position,
      List<Double> velocity,
      boolean onGround,
      double fallDistance,
      int noDamageTicks,
      boolean sprinting,
      boolean inWater,
      int foodLevel,
      double saturation,
      String difficulty,
      TraversalState traversal) {}

  record Fall(
      long sequence,
      int eventTick,
      int observedTick,
      long predictionSequence,
      boolean cancelled,
      double damage,
      double before,
      double after,
      double beforeAbsorption,
      double afterAbsorption,
      double fallDistance,
      int noDamageTicks,
      double snapshotHealth,
      long hurtTick) {}

  record Setup(long sequence, int serverTick, String kind, Map<String, String> details) {}

  record Regain(
      long sequence,
      int eventTick,
      int observedTick,
      long sourceSequence,
      long resultSequence,
      String reason,
      double amount,
      boolean cancelled,
      double before,
      double after,
      int foodLevel,
      double saturation,
      String difficulty) {}

  record Prediction(
      long sequence,
      int serverTick,
      long sourceSequence,
      long arrivalTick,
      int damage,
      double effectiveHealth,
      boolean affordable,
      boolean noSprint,
      List<Double> waypoint,
      double fallDistance) {}

  record Status(
      int version,
      String kind,
      boolean humanDemonstration,
      String scenario,
      String state,
      String match,
      String body,
      String world,
      List<Sample> samples,
      List<Fall> falls,
      List<Setup> setups,
      List<Prediction> predictions,
      List<Regain> regains) {}

  static HealthProtocol load() {
    try (var stream = HealthProtocol.class.getResourceAsStream("/rwf-health-proof.json")) {
      if (stream == null) throw new IllegalStateException("health proof contract missing");
      var wire = JSON.readValue(stream, HealthProtocol.class);
      validate(wire);
      Map<String, Class<?>> types =
          Map.of(
              "Sample",
              Sample.class,
              "Fall",
              Fall.class,
              "Setup",
              Setup.class,
              "Regain",
              Regain.class,
              "Environment",
              Environment.class,
              "Prediction",
              Prediction.class,
              "Status",
              Status.class,
              "Traversal",
              TraversalState.class);
      if (!wire.records().keySet().equals(types.keySet()))
        throw new IllegalStateException("health proof record inventory differs");
      types.forEach(
          (name, type) -> {
            var fields =
                Arrays.stream(type.getRecordComponents()).map(value -> value.getName()).toList();
            if (!fields.equals(wire.records().get(name)))
              throw new IllegalStateException("health proof fields differ: " + name);
          });
      return wire;
    } catch (IOException failure) {
      throw new IllegalStateException("health proof contract unreadable", failure);
    }
  }

  private static void validate(HealthProtocol wire) {
    if (wire.version() != 3
        || !wire.kind().equals("controlled-route-diagnostic")
        || wire.humanDemonstration()
        || !wire.environment().equals(new Environment("HARD", 7, 0))
        || wire.maximumTicks() != 600
        || wire.scenarios().isEmpty())
      throw new IllegalStateException("health proof contract incompatible");
    var ids = new java.util.HashSet<String>();
    for (var scenario : wire.scenarios()) {
      if (!ids.add(scenario.id()) || invalid(scenario))
        throw new IllegalStateException("health proof scenario invalid");
    }
  }

  private static boolean invalid(Scenario scenario) {
    return !List.of("trooper", "juggernaut").contains(scenario.kit())
        || !List.of("ground", "water").contains(scenario.landing())
        || !List.of("single", "until-refused", "protection-expiry").contains(scenario.mode())
        || scenario.maximumDrops() < 1
        || scenario.maximumDrops() > 5;
  }
}
