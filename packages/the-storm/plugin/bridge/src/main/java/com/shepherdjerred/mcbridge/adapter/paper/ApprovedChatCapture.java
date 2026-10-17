package com.shepherdjerred.mcbridge.adapter.paper;

import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/** Loaded only when TheStorm is enabled, preserving standalone MCBridge operation. */
public final class ApprovedChatCapture implements Listener {
  private final EventCapture capture;

  public ApprovedChatCapture(EventCapture capture) {
    this.capture = capture;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onChat(ApprovedChatEvent event) {
    if (event.isCancelled() || !event.delivered()) return;
    capture.deliveredChat(event.player(), event.message());
  }
}
