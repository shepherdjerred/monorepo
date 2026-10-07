package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Language-neutral wire metadata; only the disposable fixture serves this protocol. */
record DuelProtocol(
    int version,
    String contract,
    List<String> opponents,
    List<String> results,
    List<String> phases,
    List<Head> heads,
    List<String> required,
    List<String> optional) {
  record Head(String name, int size) {}

  static DuelProtocol load() {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .build();
    try (var stream = CombatHarness.class.getResourceAsStream("/rwf-duel.json")) {
      if (stream == null) throw new IllegalStateException("duel wire contract missing");
      var protocol = json.readValue(stream, DuelProtocol.class);
      if (protocol.version() != 2
          || !protocol.contract().equals("rwf-combat-v1")
          || protocol.heads().size() != 5
          || !protocol.heads().stream()
              .map(Head::name)
              .toList()
              .equals(List.of("move", "jump", "sneak", "sprint", "attack"))
          || protocol.heads().getFirst().size() != 9
          || protocol.heads().stream().skip(1).anyMatch(head -> head.size() != 2))
        throw new IllegalStateException("duel wire contract is incompatible");
      return protocol;
    } catch (IOException failure) {
      throw new IllegalStateException("duel wire contract unreadable", failure);
    }
  }

  void validate(Map<String, Object> state) {
    if (!opponents.contains(state.get("opponent"))
        || !results.contains(state.get("result"))
        || !phases.contains(state.get("phase"))
        || !state.keySet().containsAll(required)
        || state.keySet().stream()
            .anyMatch(key -> !required.contains(key) && !optional.contains(key)))
      throw new IllegalStateException("duel state fields differ from wire contract");
  }
}
