package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ActionTicket;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatAction;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** One language-neutral source of truth for the disposable regression journal. */
record RegressionProtocol(
    int version,
    String contract,
    List<String> results,
    List<String> phases,
    List<String> decisions,
    int maximumRows,
    int maximumActionAge,
    List<String> fields,
    Map<String, List<String>> records) {
  static RegressionProtocol load(Map<String, Class<?>> types) {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();
    try (var stream = CombatHarness.class.getResourceAsStream("/rwf-regression-capture.json")) {
      if (stream == null) throw new IllegalStateException("regression capture contract missing");
      var protocol = json.readValue(stream, RegressionProtocol.class);
      if (protocol.version() != 2
          || !protocol.contract().equals("rwf-regression-capture-v2")
          || protocol.maximumRows() != 5000
          || protocol.maximumActionAge() != 2)
        throw new IllegalStateException("regression capture contract incompatible");
      var all = new java.util.HashMap<>(types);
      all.put("Ticket", ActionTicket.class);
      all.put("CombatAction", CombatAction.class);
      all.put("Inference", BatchedInference.Metrics.class);
      if (!all.keySet().equals(protocol.records().keySet()))
        throw new IllegalStateException("regression capture record inventory differs");
      all.forEach((name, type) -> validateRecord(type, protocol.records().get(name)));
      return protocol;
    } catch (IOException failure) {
      throw new IllegalStateException("regression capture contract unreadable", failure);
    }
  }

  private static void validateRecord(Class<?> type, List<String> expected) {
    var names = Arrays.stream(type.getRecordComponents()).map(c -> c.getName()).toList();
    if (!names.equals(expected))
      throw new IllegalStateException("regression capture record fields differ: " + type.getName());
  }

  void validate(Map<String, Object> state) {
    if (!state.keySet().equals(new HashSet<>(fields))
        || !results.contains(state.get("result"))
        || !phases.contains(state.get("phase")))
      throw new IllegalStateException("regression capture state differs from contract");
  }
}
