package com.shepherdjerred.thestorm.core.analytics;

import java.util.UUID;

/** Typed, non-blocking product instrumentation. Calls may arrive from asynchronous chat. */
public interface ProductAnalytics {
  enum Mode {
    SURVIVAL,
    ARENA,
    SEARCH_AND_DESTROY
  }

  enum Action {
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

  /** The accepted membership transition, including lobby and spectator membership. */
  void mode(UUID player, Mode mode);

  /** An actual transition in Essentials' AFK state. */
  void afk(UUID player, boolean away);

  /** Explicitly disabled collection for isolated module tests and previews. */
  static ProductAnalytics disabled() {
    return DisabledAnalytics.INSTANCE;
  }
}
