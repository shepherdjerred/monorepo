package com.shepherdjerred.thestorm.safety.adapter.contract;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Refuse incompatible deployments before any player publication is accepted. */
public final class SharedContracts {
  private SharedContracts() {}

  public static JsonNode load(String name) {
    try (var stream = SharedContracts.class.getResourceAsStream("/contracts/" + name + ".json")) {
      if (stream == null) throw new IllegalStateException("Missing shared contract: " + name);
      var contract = JsonMapper.builder().build().readTree(stream.readAllBytes());
      if (contract.required("version").asInt() != 1)
        throw new IllegalStateException("Unsupported shared contract: " + name);
      return contract;
    } catch (IOException failure) {
      throw new IllegalStateException("Cannot load shared contract: " + name, failure);
    }
  }

  public static List<String> strings(JsonNode contract, String key) {
    return contract.required(key).valueStream().map(JsonNode::asString).toList();
  }

  public static void fields(JsonNode contract, String key, Class<? extends Record> type) {
    var actual =
        Arrays.stream(type.getRecordComponents())
            .map(java.lang.reflect.RecordComponent::getName)
            .sorted()
            .toList();
    if (!actual.equals(strings(contract, key).stream().sorted().toList()))
      throw new IllegalStateException(type.getSimpleName() + " differs from shared contract");
  }
}
