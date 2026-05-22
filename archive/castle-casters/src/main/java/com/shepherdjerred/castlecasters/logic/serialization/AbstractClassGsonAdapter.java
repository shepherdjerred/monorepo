package com.shepherdjerred.castlecasters.logic.serialization;

import com.google.gson.*;

import java.lang.reflect.Type;

public class AbstractClassGsonAdapter<T> implements JsonSerializer<T>, JsonDeserializer<T> {

  private static final String CLASS = "CLASS";
  private static final String DATA = "DATA";

  @Override
  public JsonElement serialize(T objectToSerialize,
                               Type type,
                               JsonSerializationContext jsonSerializationContext) {
    var objectAsJson = new JsonObject();
    objectAsJson.addProperty(CLASS, objectToSerialize.getClass().getCanonicalName());
    objectAsJson.add(DATA, jsonSerializationContext.serialize(objectToSerialize));
    return objectAsJson;
  }

  @Override
  public T deserialize(JsonElement objectAsJsonElement,
                       Type type,
                       JsonDeserializationContext jsonDeserializationContext) throws JsonParseException {
    var objectAsJsonObject = objectAsJsonElement.getAsJsonObject();
    var objectClassName = objectAsJsonObject.getAsJsonPrimitive(CLASS).getAsString();
    var objectClass = classNameToClass(objectClassName);
    return jsonDeserializationContext.deserialize(objectAsJsonObject.get(DATA), objectClass);
  }

  /**
   * Helper method to get the className of the object to be deserialized.
   */
  private Class<?> classNameToClass(String className) {
    try {
      return Class.forName(className);
    } catch (ClassNotFoundException e) {
      throw new JsonParseException(e);
    }
  }
}
