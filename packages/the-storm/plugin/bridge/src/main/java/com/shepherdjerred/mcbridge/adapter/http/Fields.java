package com.shepherdjerred.mcbridge.adapter.http;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.Box;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * Strict access to one JSON object: unknown keys and wrong types are 400s, mirroring the harness's
 * zod {@code strictObject} schemas so version skew fails loudly.
 */
public final class Fields {
  private final JsonObject object;
  private final String path;

  private Fields(JsonObject object, String path, Set<String> allowed) {
    this.object = object;
    this.path = path;
    Set<String> unknown = new TreeSet<>(object.keySet());
    unknown.removeAll(allowed);
    if (!unknown.isEmpty()) {
      throw BridgeException.badRequest(path + " has unknown keys " + unknown);
    }
  }

  /** Parses a request body that must be one JSON object with only {@code allowed} keys. */
  public static Fields parseBody(byte[] body, Set<String> allowed) {
    JsonElement element;
    try {
      element = JsonParser.parseString(new String(body, StandardCharsets.UTF_8));
    } catch (JsonParseException e) {
      throw new BridgeException(ErrorCode.BAD_REQUEST, "body is not valid JSON", e);
    }
    if (!element.isJsonObject()) {
      throw BridgeException.badRequest("body must be a JSON object");
    }
    return new Fields(element.getAsJsonObject(), "body", allowed);
  }

  /** Wraps a nested object. */
  public static Fields of(JsonElement element, String path, Set<String> allowed) {
    if (!element.isJsonObject()) {
      throw BridgeException.badRequest(path + " must be an object");
    }
    return new Fields(element.getAsJsonObject(), path, allowed);
  }

  public boolean has(String key) {
    return object.has(key) && !object.get(key).isJsonNull();
  }

  public String string(String key) {
    JsonPrimitive primitive = primitive(key);
    if (!primitive.isString()) {
      throw BridgeException.badRequest(field(key) + " must be a string");
    }
    return primitive.getAsString();
  }

  /** A string that must not be empty. */
  public String nonEmptyString(String key) {
    String value = string(key);
    if (value.isEmpty()) {
      throw BridgeException.badRequest(field(key) + " must not be empty");
    }
    return value;
  }

  public Optional<String> optionalString(String key) {
    return has(key) ? Optional.of(string(key)) : Optional.empty();
  }

  public int integer(String key) {
    JsonPrimitive primitive = primitive(key);
    if (!primitive.isNumber()) {
      throw BridgeException.badRequest(field(key) + " must be an integer");
    }
    BigDecimal value = primitive.getAsBigDecimal();
    try {
      return value.intValueExact();
    } catch (ArithmeticException e) {
      throw BridgeException.badRequest(field(key) + " must be a 32-bit integer");
    }
  }

  public Optional<Integer> optionalInteger(String key) {
    return has(key) ? Optional.of(integer(key)) : Optional.empty();
  }

  /** Any finite JSON number. */
  public double number(String key) {
    JsonPrimitive primitive = primitive(key);
    if (!primitive.isNumber()) {
      throw BridgeException.badRequest(field(key) + " must be a number");
    }
    double value = primitive.getAsDouble();
    if (!Double.isFinite(value)) {
      throw BridgeException.badRequest(field(key) + " must be finite");
    }
    return value;
  }

  public Optional<Double> optionalNumber(String key) {
    return has(key) ? Optional.of(number(key)) : Optional.empty();
  }

  public Optional<Boolean> optionalBool(String key) {
    return has(key) ? Optional.of(bool(key)) : Optional.empty();
  }

  public boolean bool(String key) {
    JsonPrimitive primitive = primitive(key);
    if (!primitive.isBoolean()) {
      throw BridgeException.badRequest(field(key) + " must be a boolean");
    }
    return primitive.getAsBoolean();
  }

  public JsonArray array(String key) {
    JsonElement element = require(key);
    if (!element.isJsonArray()) {
      throw BridgeException.badRequest(field(key) + " must be an array");
    }
    return element.getAsJsonArray();
  }

  /** A nested object with only {@code allowed} keys. */
  public Fields object(String key, Set<String> allowed) {
    return of(require(key), field(key), allowed);
  }

  /** A {@code {x, y, z}} integer position. */
  public BlockPos blockPos(String key) {
    return toBlockPos(object(key, Set.of("x", "y", "z")));
  }

  public Optional<BlockPos> optionalBlockPos(String key) {
    return has(key) ? Optional.of(blockPos(key)) : Optional.empty();
  }

  /** A {@code {world, min, max}} box, normalized. */
  public Box box(String key) {
    return toBox(object(key, BOX_KEYS));
  }

  /** Reads this object itself as a {@code {world, min, max}} box. */
  public Box asBox() {
    return Box.of(nonEmptyString("world"), blockPos("min"), blockPos("max"));
  }

  /** The keys of a box object. */
  public static final Set<String> BOX_KEYS = Set.of("world", "min", "max");

  private static Box toBox(Fields fields) {
    return fields.asBox();
  }

  private static BlockPos toBlockPos(Fields fields) {
    return new BlockPos(fields.integer("x"), fields.integer("y"), fields.integer("z"));
  }

  private JsonElement require(String key) {
    if (!has(key)) {
      throw BridgeException.badRequest(field(key) + " is required");
    }
    return object.get(key);
  }

  private JsonPrimitive primitive(String key) {
    JsonElement element = require(key);
    if (!element.isJsonPrimitive()) {
      throw BridgeException.badRequest(field(key) + " must be a primitive");
    }
    return element.getAsJsonPrimitive();
  }

  private String field(String key) {
    return path + "." + key;
  }
}
