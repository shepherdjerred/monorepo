package com.shepherdjerred.thestorm.client;

import java.util.HashSet;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The versioned local wire contract; fixtures are shared with the Bun controller. */
final class Protocol {
  static final int VERSION = 1;
  static final int MAX_FRAME = 65_536;
  static final JsonMapper JSON = JsonMapper.builder().build();

  private Protocol() {}

  record Request(int version, String id, String action, JsonNode arguments) {}

  record Success(int version, String id, boolean ok, Object result) {}

  record Failure(int version, String id, boolean ok, String error) {}

  static Request read(String line) {
    if (line.length() > MAX_FRAME) throw new IllegalArgumentException("Request is too large");
    var node = JSON.readTree(line);
    keys(node, Set.of("version", "id", "action", "arguments"));
    var version = integer(node, "version", VERSION, VERSION);
    var id = text(node, "id", 100);
    var action = text(node, "action", 32);
    var arguments = node.required("arguments");
    if (!arguments.isObject()) throw new IllegalArgumentException("arguments must be an object");
    return new Request(version, id, action, arguments);
  }

  static void keys(JsonNode node, Set<String> expected) {
    if (!node.isObject()) throw new IllegalArgumentException("Expected an object");
    var actual = new HashSet<String>();
    node.propertyNames().forEach(actual::add);
    if (!actual.equals(expected))
      throw new IllegalArgumentException("Unexpected or missing fields");
  }

  static String text(JsonNode node, String key, int max) {
    var value = node.required(key);
    if (!value.isString() || value.stringValue().isBlank() || value.stringValue().length() > max) {
      throw new IllegalArgumentException("Invalid " + key);
    }
    return value.stringValue();
  }

  static int integer(JsonNode node, String key, int min, int max) {
    var value = node.required(key);
    if (!value.isIntegralNumber() || !value.canConvertToInt()) {
      throw new IllegalArgumentException("Invalid " + key);
    }
    var number = value.intValue();
    if (number < min || number > max) throw new IllegalArgumentException("Invalid " + key);
    return number;
  }

  static float angle(JsonNode node, String key, float min, float max) {
    var value = node.required(key);
    if (!value.isNumber()) throw new IllegalArgumentException("Invalid " + key);
    var angle = value.doubleValue();
    if (!Double.isFinite(angle) || angle < min || angle > max) {
      throw new IllegalArgumentException("Invalid " + key);
    }
    return (float) angle;
  }
}
