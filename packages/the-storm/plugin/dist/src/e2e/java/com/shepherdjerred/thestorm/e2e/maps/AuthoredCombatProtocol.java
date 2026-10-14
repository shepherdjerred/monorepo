package com.shepherdjerred.thestorm.e2e.maps;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Exact native-observer inventory shared with the independent TypeScript verifier. */
record AuthoredCombatProtocol(
    int version,
    String kind,
    boolean humanDemonstration,
    boolean authoredBotControl,
    int maximumTicks,
    int maximumRows,
    Map<String, List<String>> records) {
  static AuthoredCombatProtocol load(Map<String, Class<?>> types) {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();
    try (var stream =
        AuthoredCombatProtocol.class.getResourceAsStream("/rwf-authored-combat.json")) {
      if (stream == null) throw new IllegalStateException("authored combat contract missing");
      var wire = json.readValue(stream, AuthoredCombatProtocol.class);
      if (wire.version() != 1
          || !wire.kind().equals("rwf-authored-npc-human-combat")
          || wire.humanDemonstration()
          || !wire.authoredBotControl()
          || wire.maximumTicks() != 1200
          || wire.maximumRows() != 4096
          || !wire.records().keySet().equals(types.keySet()))
        throw new IllegalStateException("authored combat contract incompatible");
      types.forEach(
          (name, type) -> {
            var fields =
                Arrays.stream(type.getRecordComponents()).map(field -> field.getName()).toList();
            if (!fields.equals(wire.records().get(name)))
              throw new IllegalStateException("authored combat fields differ: " + name);
          });
      return wire;
    } catch (IOException failure) {
      throw new IllegalStateException("authored combat contract unreadable", failure);
    }
  }
}
