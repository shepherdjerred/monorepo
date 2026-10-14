package com.shepherdjerred.thestorm.rwf.app;

import static java.util.Objects.requireNonNull;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Host ownership and preferences shared by consecutive rounds, owned by the main thread. */
public final class LobbySession {
  private Optional<UUID> host = Optional.empty();
  private BotSettings selected = BotSettings.DEFAULT;
  private BotSettings current = BotSettings.DEFAULT;
  private boolean locked;

  public Optional<UUID> host() {
    return host;
  }

  public boolean hosts(UUID player) {
    return host.filter(player::equals).isPresent();
  }

  /** Humans are supplied in admission order; bots and watchers never enter this list. */
  public void sync(List<UUID> humans) {
    if (humans.isEmpty()) {
      host = Optional.empty();
      selected = BotSettings.DEFAULT;
      current = BotSettings.DEFAULT;
      locked = false;
    } else if (host.isEmpty() || !humans.contains(host.orElseThrow())) {
      host = Optional.of(humans.getFirst());
    }
  }

  public BotSettings selected() {
    return selected;
  }

  public BotSettings current() {
    return locked ? current : selected;
  }

  public boolean locked() {
    return locked;
  }

  /** Even stale menus must still authenticate the current host. */
  public boolean select(UUID player, BotSettings settings) {
    if (!hosts(player)) {
      return false;
    }
    selected = requireNonNull(settings);
    return true;
  }

  public void lock() {
    if (!locked) {
      current = selected;
      locked = true;
    }
  }

  public void nextRound() {
    locked = false;
  }
}
