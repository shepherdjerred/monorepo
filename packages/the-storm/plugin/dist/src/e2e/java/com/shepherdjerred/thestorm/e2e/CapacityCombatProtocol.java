package com.shepherdjerred.thestorm.e2e;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** The passive disposable observer and its verifier share one neutral wire contract. */
record CapacityCombatProtocol(
    int version,
    String kind,
    int maximumRows,
    List<String> damageCauses,
    List<String> deathCauses,
    Map<String, List<String>> records) {
  static CapacityCombatProtocol load(Map<String, Class<?>> types) {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();
    try (var stream =
        CapacityCombatProtocol.class.getResourceAsStream("/rwf-capacity-combat.json")) {
      if (stream == null) throw new IllegalStateException("capacity combat contract missing");
      var wire = json.readValue(stream, CapacityCombatProtocol.class);
      if (wire.version() != 1
          || !wire.kind().equals("rwf-capacity-combat")
          || wire.maximumRows() != 4096
          || !wire.damageCauses().equals(List.of("ENTITY_ATTACK", "PROJECTILE"))
          || !wire.deathCauses().equals(List.of("Melee", "Projectile"))
          || !wire.records().keySet().equals(types.keySet()))
        throw new IllegalStateException("capacity combat contract incompatible");
      types.forEach(
          (name, type) -> {
            var fields =
                Arrays.stream(type.getRecordComponents()).map(field -> field.getName()).toList();
            if (!fields.equals(wire.records().get(name)))
              throw new IllegalStateException("capacity combat fields differ: " + name);
          });
      return wire;
    } catch (IOException failure) {
      throw new IllegalStateException("capacity combat contract unreadable", failure);
    }
  }
}
