package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Versioned, language-neutral console contract for disposable inference load evidence. */
record InferenceLoadProtocol(
    int version,
    String contract,
    List<String> results,
    List<String> phases,
    List<String> required,
    List<String> optional,
    List<String> tickFields,
    List<String> inferenceFields) {
  static InferenceLoadProtocol load(Class<?> tickType) {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();
    try (var stream = CombatHarness.class.getResourceAsStream("/rwf-inference-load.json")) {
      if (stream == null) throw new IllegalStateException("inference load contract missing");
      var protocol = json.readValue(stream, InferenceLoadProtocol.class);
      if (protocol.version() != 1 || !protocol.contract().equals("rwf-inference-load-v1"))
        throw new IllegalStateException("inference load contract is incompatible");
      validateRecord(tickType, protocol.tickFields());
      validateRecord(BatchedInference.Metrics.class, protocol.inferenceFields());
      return protocol;
    } catch (IOException failure) {
      throw new IllegalStateException("inference load contract unreadable", failure);
    }
  }

  private static void validateRecord(Class<?> type, List<String> expected) {
    var names = Arrays.stream(type.getRecordComponents()).map(c -> c.getName()).toList();
    if (names.size() != expected.size() || !new HashSet<>(names).equals(new HashSet<>(expected)))
      throw new IllegalStateException("inference load record fields differ from contract");
  }

  void validate(Map<String, Object> state) {
    if (!state.keySet().containsAll(required)
        || state.size() != required.size() + (state.containsKey("inference") ? 1 : 0)
        || state.keySet().stream()
            .anyMatch(key -> !required.contains(key) && !optional.contains(key))
        || !results.contains(state.get("result"))
        || !phases.contains(state.get("phase")))
      throw new IllegalStateException("inference load state fields differ from contract");
  }
}
