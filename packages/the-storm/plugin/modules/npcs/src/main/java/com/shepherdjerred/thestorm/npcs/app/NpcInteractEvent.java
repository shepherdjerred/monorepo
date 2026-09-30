package com.shepherdjerred.thestorm.npcs.app;

import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

/**
 * A player right-clicked an NPC. Fired on the main thread before the NPC's dialogue opens;
 * cancelling it stops the dialogue, so a module can take over the click entirely.
 */
public final class NpcInteractEvent extends Event implements Cancellable {

  private static final HandlerList HANDLERS = new HandlerList();

  private final Player player;
  private final NpcRef npc;
  private boolean cancelled;

  public NpcInteractEvent(Player player, NpcRef npc) {
    this.player = player;
    this.npc = npc;
  }

  public Player player() {
    return player;
  }

  public NpcRef npc() {
    return npc;
  }

  @Override
  public boolean isCancelled() {
    return cancelled;
  }

  @Override
  public void setCancelled(boolean cancel) {
    cancelled = cancel;
  }

  @Override
  public HandlerList getHandlers() {
    return HANDLERS;
  }

  public static HandlerList getHandlerList() {
    return HANDLERS;
  }
}
