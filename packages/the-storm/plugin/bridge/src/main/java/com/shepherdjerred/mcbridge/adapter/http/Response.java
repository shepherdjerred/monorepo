package com.shepherdjerred.mcbridge.adapter.http;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import java.nio.charset.StandardCharsets;

/** A response body with its status and content type. */
public final class Response {
  // serializeNulls: a member set to JsonNull is a contract `null` (nullable
  // fields); absent optional fields are simply never added.
  private static final Gson GSON =
      new GsonBuilder().disableHtmlEscaping().serializeNulls().create();
  private static final String JSON = "application/json";

  private final int status;
  private final String contentType;
  private final byte[] body;

  private Response(int status, String contentType, byte[] body) {
    this.status = status;
    this.contentType = contentType;
    this.body = body;
  }

  public int status() {
    return status;
  }

  public String contentType() {
    return contentType;
  }

  /** The encoded body. */
  public byte[] body() {
    return body.clone();
  }

  /** A 200 JSON response. */
  public static Response json(JsonElement element) {
    return new Response(200, JSON, GSON.toJson(element).getBytes(StandardCharsets.UTF_8));
  }

  /** A 200 binary response. */
  public static Response bytes(byte[] body) {
    return new Response(200, "application/octet-stream", body);
  }

  /** The {@code BridgeErrorSchema} body for a failure. */
  public static Response error(ErrorCode code, String message) {
    JsonObject object = new JsonObject();
    object.addProperty("error", message);
    object.addProperty("code", code.wire());
    return new Response(code.status(), JSON, GSON.toJson(object).getBytes(StandardCharsets.UTF_8));
  }
}
