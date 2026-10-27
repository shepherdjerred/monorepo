package com.shepherdjerred.thestorm.reset.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.reset.app.ResetStore;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/** Keeps partially reset accounts offline until cleanup finishes. */
public final class ResetLoginGate implements Listener {

  private final ResetStore store;
  private final ModuleContext context;

  public ResetLoginGate(ResetStore store, ModuleContext context) {
    this.store = store;
    this.context = context;
  }

  @EventHandler
  public void onPreLogin(AsyncPlayerPreLoginEvent event) {
    var _ =
        store
            .isPending(event.getUniqueId())
            .whenComplete(
                (pending, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not check player reset status", failure);
                    event.disallow(
                        AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
                        Component.text(
                            "Player reset status is unavailable. Please try again shortly."));
                  } else if (Boolean.TRUE.equals(pending)) {
                    event.disallow(
                        AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
                        Component.text(
                            "Your player reset is still finishing. Please try again shortly."));
                  }
                });
  }
}
