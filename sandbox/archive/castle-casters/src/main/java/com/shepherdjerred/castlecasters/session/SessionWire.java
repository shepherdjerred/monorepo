package com.shepherdjerred.castlecasters.session;

import com.google.gson.*;
import io.netty.channel.ChannelPipeline;
import io.netty.handler.codec.*;
import io.netty.handler.codec.string.*;
import java.nio.charset.StandardCharsets;

public final class SessionWire {
  public static final int VERSION = 2;
  public static final Gson JSON = new Gson();

  private SessionWire() {}

  public static void pipeline(ChannelPipeline pipeline) {
    pipeline.addLast(
        new LengthFieldBasedFrameDecoder(1_048_576, 0, 4, 0, 4),
        new StringDecoder(StandardCharsets.UTF_8),
        new LengthFieldPrepender(4),
        new StringEncoder(StandardCharsets.UTF_8));
  }

  public static JsonObject message(String type) {
    var object = new JsonObject();
    object.addProperty("v", VERSION);
    object.addProperty("type", type);
    return object;
  }

  public static JsonObject parse(String text) {
    var object = JsonParser.parseString(text).getAsJsonObject();
    if (!object.has("v") || object.get("v").getAsInt() != VERSION)
      throw new IllegalArgumentException("Please use the same Castle Casters version as the host");
    if (!object.has("type") || !object.get("type").isJsonPrimitive())
      throw new IllegalArgumentException("Missing message type");
    return object;
  }
}
