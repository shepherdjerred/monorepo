package com.shepherdjerred.thestorm.reset.adapter.paper;

import com.shepherdjerred.thestorm.reset.app.PlayerResetService;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/** Keeps partially reset accounts offline until cleanup finishes. */
public final class ResetLoginGate implements Listener {

  private final PlayerResetService resets;

  public ResetLoginGate(PlayerResetService resets) {
    this.resets = resets;
  }

  @EventHandler
  public void onPreLogin(AsyncPlayerPreLoginEvent event) {
    if (resets.isPending(event.getUniqueId())) {
      event.disallow(
          AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
          Component.text("Your player reset is still finishing. Please try again shortly."));
    }
  }
}
