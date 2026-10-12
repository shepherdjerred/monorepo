package com.shepherdjerred.mcbridge.adapter.http;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.Box;
import com.shepherdjerred.mcbridge.domain.BridgeEvent;
import java.util.List;

/** Wire encodings shared by the handlers. */
public final class Json {
  private Json() {}

  /** {@code {x, y, z}}. */
  public static JsonObject pos(BlockPos pos) {
    JsonObject object = new JsonObject();
    object.addProperty("x", pos.x());
    object.addProperty("y", pos.y());
    object.addProperty("z", pos.z());
    return object;
  }

  /** {@code {world, min, max}}. */
  public static JsonObject box(Box box) {
    JsonObject object = new JsonObject();
    object.addProperty("world", box.world());
    object.add("min", pos(box.min()));
    object.add("max", pos(box.max()));
    return object;
  }

  /** One {@code BridgeEventSchema} object. */
  public static JsonObject event(BridgeEvent event) {
    JsonObject object = new JsonObject();
    object.addProperty("seq", event.seq());
    object.addProperty("ts", event.ts().toString());
    object.addProperty("type", event.type().wire());
    if (event.player() != null) {
      object.addProperty("player", event.player());
    }
    object.addProperty("text", event.text());
    return object;
  }

  /** A JSON array of strings. */
  public static JsonArray strings(List<String> values) {
    JsonArray array = new JsonArray();
    values.forEach(array::add);
    return array;
  }
}
