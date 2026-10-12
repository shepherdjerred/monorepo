package com.shepherdjerred.thestorm.tools.rwfmap;

import java.util.Map;
import java.util.TreeMap;

/**
 * A block state as the server writes it: {@code minecraft:oak_slab[type=top,waterlogged=false]}.
 *
 * @param id the block id without the {@code minecraft:} namespace, such as {@code oak_slab}
 * @param properties the state properties, by name
 */
record BlockState(String id, Map<String, String> properties) {

  private static final String NAMESPACE = "minecraft:";

  BlockState {
    if (id.isBlank()) {
      throw new IllegalArgumentException("block id must not be blank");
    }
    properties = Map.copyOf(new TreeMap<>(properties));
  }

  /** Parses a canonical block-state string; anything else is an error naming the text. */
  static BlockState parse(String state) {
    if (!state.startsWith(NAMESPACE)) {
      throw new IllegalArgumentException("block state is not in the minecraft namespace: " + state);
    }
    var open = state.indexOf('[');
    if (open < 0) {
      return new BlockState(state.substring(NAMESPACE.length()), Map.of());
    }
    if (!state.endsWith("]")) {
      throw new IllegalArgumentException("block state properties are not closed: " + state);
    }
    var id = state.substring(NAMESPACE.length(), open);
    var properties = new TreeMap<String, String>();
    var body = state.substring(open + 1, state.length() - 1);
    var start = 0;
    while (start <= body.length()) {
      var end = body.indexOf(',', start);
      if (end < 0) {
        end = body.length();
      }
      var pair = body.substring(start, end);
      var equals = pair.indexOf('=');
      if (equals <= 0 || equals == pair.length() - 1) {
        throw new IllegalArgumentException("block state property is not name=value: " + state);
      }
      if (properties.put(pair.substring(0, equals), pair.substring(equals + 1)) != null) {
        throw new IllegalArgumentException("block state property repeats: " + state);
      }
      start = end + 1;
    }
    return new BlockState(id, properties);
  }

  /** The property, which must be present. */
  String property(String name) {
    var value = properties.get(name);
    if (value == null) {
      throw new UnknownBlockStateException(
          NAMESPACE + id + " lacks the " + name + " property the block table needs");
    }
    return value;
  }

  boolean idEndsWith(String suffix) {
    return id.endsWith(suffix);
  }
}
