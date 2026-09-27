package com.shepherdjerred.thestorm.quests.adapter.db;

import com.shepherdjerred.thestorm.quests.domain.model.Action;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Strictly enumerates the world actions that may be held in the durable quest outbox. */
final class WorldActionCodec {

  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private WorldActionCodec() {}

  static String kind(Action action) {
    return switch (action) {
      case Action.Give _ -> "give";
      case Action.Take _ ->
          throw new IllegalArgumentException("consumables must be reserved before save");
      case Action.Crystals _ -> "crystals";
      case Action.Grant _ -> "grant";
      case Action.Title _ -> "title";
      case Action.Spell _ -> "spell";
      case Action.Message _ -> "message";
      case Action.Teleport _ -> "teleport";
      case Action.Spawn _ -> "spawn";
      case Action.Custom _ -> "custom";
      case Action.SetVariable _,
          Action.AddVariable _,
          Action.Reputation _,
          Action.Points _,
          Action.StartQuest _,
          Action.Marker _ ->
          throw new IllegalArgumentException("state action cannot enter world outbox");
    };
  }

  static String payload(Action action) {
    return JSON.writeValueAsString(action);
  }

  static Action decode(String kind, String payload) {
    return switch (kind) {
      case "give" -> JSON.readValue(payload, Action.Give.class);
      case "crystals" -> JSON.readValue(payload, Action.Crystals.class);
      case "grant" -> JSON.readValue(payload, Action.Grant.class);
      case "title" -> JSON.readValue(payload, Action.Title.class);
      case "spell" -> JSON.readValue(payload, Action.Spell.class);
      case "message" -> JSON.readValue(payload, Action.Message.class);
      case "teleport" -> JSON.readValue(payload, Action.Teleport.class);
      case "spawn" -> JSON.readValue(payload, Action.Spawn.class);
      case "custom" -> JSON.readValue(payload, Action.Custom.class);
      default -> throw new IllegalStateException("unknown pending quest action: " + kind);
    };
  }
}
