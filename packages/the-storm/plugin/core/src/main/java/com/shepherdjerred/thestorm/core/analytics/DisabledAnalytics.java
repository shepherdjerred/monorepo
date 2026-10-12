package com.shepherdjerred.thestorm.core.analytics;

import java.util.Map;
import java.util.UUID;

enum DisabledAnalytics implements ProductAnalytics {
  INSTANCE;

  @Override
  public void interaction(UUID player, Action action) {
    // Collection is explicitly disabled.
  }

  @Override
  public void game(UUID player, GameEvent event, Map<String, Object> properties) {
    ProductAnalytics.checked(properties);
  }

  @Override
  public void mode(UUID player, Mode mode) {
    // Collection is explicitly disabled.
  }

  @Override
  public void afk(UUID player, boolean away) {
    // Collection is explicitly disabled.
  }
}
