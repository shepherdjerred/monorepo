package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/**
 * Refuses banned players at login. Until the audit log is fully replayed, login fails closed
 * immediately so no Paper login worker waits for storage.
 */
final class BanListener implements Listener {

  private final PaperRuntime runtime;
  private final ModerationService moderation;

  BanListener(PaperRuntime runtime, ModerationService moderation) {
    this.runtime = runtime;
    this.moderation = moderation;
  }

  @EventHandler(priority = EventPriority.LOW)
  void onPreLogin(AsyncPlayerPreLoginEvent event) {
    if (event.getLoginResult() != AsyncPlayerPreLoginEvent.Result.ALLOWED) {
      return;
    }
    if (!moderation.ready()) {
      refuse(event);
      return;
    }
    moderation
        .activeBanNow(event.getUniqueId())
        .ifPresent(
            ban ->
                event.disallow(
                    AsyncPlayerPreLoginEvent.Result.KICK_BANNED,
                    BanMessages.banned(ban, runtime.time().instant())));
  }

  private void refuse(AsyncPlayerPreLoginEvent event) {
    event.disallow(
        AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
        Component.text("The Storm could not check its ban list. Please try again in a minute."));
  }
}
