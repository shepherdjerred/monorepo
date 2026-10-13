package com.shepherdjerred.thestorm.rwf.adapter.db;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The {@code kit_layouts} column of {@code rwf_player_prefs}: a JSON object from kit id to an
 * object from item position to inventory slot, as {@code {"trooper":{"0":0,"1":2,"2":1}}}.
 */
final class KitLayoutsJson {

  private static final JsonMapper JSON = JsonMapper.builder().build();

  private KitLayoutsJson() {}

  /** The layouts {@code text} holds; a malformed column fails loudly. */
  static Map<String, KitLayout> read(String text) {
    var root = JSON.readTree(text);
    if (!root.isObject()) {
      throw new IllegalStateException("kit_layouts must be a JSON object: " + text);
    }
    var layouts = new HashMap<String, KitLayout>();
    for (var kit : root.properties()) {
      if (!kit.getValue().isObject()) {
        throw new IllegalStateException("a kit layout must be a JSON object: " + kit.getKey());
      }
      var slots = new TreeMap<Integer, Integer>();
      for (var item : kit.getValue().properties()) {
        if (!item.getValue().isInt()) {
          throw new IllegalStateException("a layout slot must be an integer: " + kit.getKey());
        }
        slots.put(Integer.parseInt(item.getKey()), item.getValue().intValue());
      }
      layouts.put(kit.getKey(), new KitLayout(slots));
    }
    return Map.copyOf(layouts);
  }

  /** {@code layouts} as the column stores them, kits and positions in order. */
  static String write(Map<String, KitLayout> layouts) {
    ObjectNode root = JSON.createObjectNode();
    for (var kit : new TreeMap<>(layouts).entrySet()) {
      var slots = root.putObject(kit.getKey());
      for (var item : new TreeMap<>(kit.getValue().slots()).entrySet()) {
        slots.put(String.valueOf(item.getKey()), item.getValue().intValue());
      }
    }
    return JSON.writeValueAsString(root);
  }
}
