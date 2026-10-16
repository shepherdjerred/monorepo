package com.shepherdjerred.thestorm.core.analytics;

import java.util.Map;
import java.util.UUID;

/** Typed, non-blocking product instrumentation. Calls may arrive from asynchronous chat. */
public interface ProductAnalytics {
  enum Mode {
    SURVIVAL,
    ARENA,
    SEARCH_AND_DESTROY
  }

  enum Action {
    GUIDE_OPENED("onboarding", "guide_opened"),
    HOME_SET("survival", "home_set"),
    HOME_USED("survival", "home_used"),
    WARP_USED("survival", "warp_used"),
    RANDOM_TELEPORT("survival", "random_teleport"),
    BALANCE_VIEWED("economy", "balance_viewed"),
    MONEY_TRANSFERRED("economy", "money_transferred"),
    SHOP_OPENED("shops", "opened"),
    SHOP_BOUGHT("shops", "bought"),
    SHOP_SOLD("shops", "sold"),
    TOWN_VIEWED("towns", "viewed"),
    TOWN_CREATED("towns", "created"),
    TOWN_JOINED("towns", "joined"),
    LAND_CLAIMED("towns", "land_claimed"),
    QUEST_JOURNAL_OPENED("quests", "journal_opened"),
    QUEST_STARTED("quests", "started"),
    QUEST_COMPLETED("quests", "completed"),
    SPELL_CAST("spells", "cast"),
    COMPANION_REQUESTED("companions", "conversation_requested"),
    COMPANION_REPLIED("companions", "reply_delivered"),
    ARENA_JOINED("arena", "joined"),
    ARENA_STARTED("arena", "match_started"),
    ARENA_COMPLETED("arena", "match_completed"),
    ARENA_LEFT("arena", "left"),
    RWF_JOINED("search_and_destroy", "joined"),
    RWF_STARTED("search_and_destroy", "match_started"),
    RWF_COMPLETED("search_and_destroy", "match_completed"),
    RWF_LEFT("search_and_destroy", "left");

    private final String feature;
    private final String action;

    Action(String feature, String action) {
      this.feature = feature;
      this.action = action;
    }

    public String feature() {
      return feature;
    }

    public String action() {
      return action;
    }
  }

  /** One authoritative accepted interaction, never a command attempt or automatic reward. */
  void interaction(UUID player, Action action);

  /**
   * A named game event a player caused, sent under its own PostHog event name. Properties are
   * bounded game facts (ids, counts, outcomes); never names, chat or anything typed.
   */
  enum GameEvent {
    /** A human's Search and Destroy match ended, with their result and score. */
    RWF_MATCH_COMPLETED("rwf_match_completed"),
    /** A human picked a kit. */
    RWF_KIT_SELECTED("rwf_kit_selected"),
    /** A human voted for a map. */
    RWF_MAP_VOTE("rwf_map_vote"),
    /** A human used a killstreak reward. */
    RWF_KILLSTREAK_USED("rwf_killstreak_used"),
    /** A human bought a kit. */
    RWF_KIT_PURCHASED("rwf_kit_purchased");

    private final String eventName;

    GameEvent(String eventName) {
      this.eventName = eventName;
    }

    public String eventName() {
      return eventName;
    }
  }

  /**
   * {@code player} caused {@code event}. Values are strings, numbers or booleans; anything else is
   * a programming error and throws.
   */
  void game(UUID player, GameEvent event, Map<String, Object> properties);

  /** Throws unless every value of {@code properties} is a string, number or boolean. */
  static Map<String, Object> checked(Map<String, Object> properties) {
    for (var entry : properties.entrySet()) {
      var value = entry.getValue();
      if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
        throw new IllegalArgumentException(
            "analytics property " + entry.getKey() + " must be a string, number or boolean");
      }
    }
    return Map.copyOf(properties);
  }

  /** The accepted membership transition, including lobby and spectator membership. */
  void mode(UUID player, Mode mode);

  /** An actual transition in Essentials' AFK state. */
  void afk(UUID player, boolean away);

  /** Explicitly disabled collection for isolated module tests and previews. */
  static ProductAnalytics disabled() {
    return DisabledAnalytics.INSTANCE;
  }
}
