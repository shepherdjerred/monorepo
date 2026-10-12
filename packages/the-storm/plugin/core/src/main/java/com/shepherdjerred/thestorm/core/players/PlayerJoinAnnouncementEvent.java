package com.shepherdjerred.thestorm.core.players;

import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.jspecify.annotations.NullMarked;

/**
 * Fired when staff visibility restoration has resolved whether a joining player may be announced.
 */
@NullMarked
public final class PlayerJoinAnnouncementEvent extends Event {
  private static final HandlerList HANDLERS = new HandlerList();

  private final Player player;
  private final boolean visible;

  public PlayerJoinAnnouncementEvent(Player player, boolean visible) {
    this.player = player;
    this.visible = visible;
  }

  public Player player() {
    return player;
  }

  public boolean visible() {
    return visible;
  }

  @Override
  public HandlerList getHandlers() {
    return HANDLERS;
  }

  public static HandlerList getHandlerList() {
    return HANDLERS;
  }
}
