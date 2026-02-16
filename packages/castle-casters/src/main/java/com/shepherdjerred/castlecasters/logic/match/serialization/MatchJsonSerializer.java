package com.shepherdjerred.castlecasters.logic.match.serialization;

import com.google.common.base.Charsets;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.piece.Piece;
import com.shepherdjerred.castlecasters.logic.serialization.AbstractClassGsonAdapter;

import java.nio.charset.StandardCharsets;

public class MatchJsonSerializer implements MatchSerializer {

  @Override
  public byte[] toBytes(Match match) {
    var matchAsJsonString = toJsonString(match);
    return matchAsJsonString.getBytes(StandardCharsets.UTF_8);
  }

  @Override
  public Match fromBytes(byte[] matchJsonAsBytes) {
    var matchAsJsonString = new String(matchJsonAsBytes, Charsets.UTF_8);
    return fromJsonString(matchAsJsonString);
  }

  public Match fromJson(JsonElement matchAsJsonElement) {
    return getGson().fromJson(matchAsJsonElement, Match.class);
  }

  public Match fromJsonString(String matchAsJsonString) {
    return getGson().fromJson(matchAsJsonString, Match.class);
  }

  public JsonElement toJson(Match match) {
    return getGson().toJsonTree(match);
  }

  public String toJsonString(Match match) {
    return toJson(match).toString();
  }

  private Gson getGson() {
    GsonBuilder builder = new GsonBuilder();
    builder
        .registerTypeAdapter(Piece.class, new AbstractClassGsonAdapter())
        .enableComplexMapKeySerialization();
    return builder.create();
  }

}
