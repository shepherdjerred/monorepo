package com.shepherdjerred.thestorm.core.safety;

import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

/** Approved text, delivered on the main thread through the normal channel router. */
public final class ApprovedChatEvent extends Event implements Cancellable {
  private static final HandlerList HANDLERS = new HandlerList();
  private final Player player;
  private final Component message;
  private final UUID submission;
  private boolean cancelled;
  private boolean delivered;

  public ApprovedChatEvent(Player player, Component message, UUID submission) {
    this.player = player;
    this.message = message;
    this.submission = submission;
  }

  public Player player() {
    return player;
  }

  public Component message() {
    return message;
  }

  public UUID submission() {
    return submission;
  }

  public boolean delivered() {
    return delivered;
  }

  public void markDelivered() {
    delivered = true;
  }

  @Override
  public boolean isCancelled() {
    return cancelled;
  }

  @Override
  public void setCancelled(boolean value) {
    cancelled = value;
  }

  @Override
  public HandlerList getHandlers() {
    return HANDLERS;
  }

  public static HandlerList getHandlerList() {
    return HANDLERS;
  }
}
