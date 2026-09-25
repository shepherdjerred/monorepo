package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/**
 * Refuses banned players at login. The event runs on a login thread, not the main thread, so it may
 * wait for the audit log to finish loading at startup; after that the answer comes from memory. If
 * the ban list cannot be read, the login is refused rather than let a banned player in.
 */
final class BanListener implements Listener {

  private static final long LOAD_WAIT_SECONDS = 10;

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
    try {
      moderation
          .activeBan(event.getUniqueId())
          .get(LOAD_WAIT_SECONDS, TimeUnit.SECONDS)
          .ifPresent(
              ban ->
                  event.disallow(
                      AsyncPlayerPreLoginEvent.Result.KICK_BANNED,
                      BanMessages.banned(ban, runtime.time().instant())));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      refuse(event, e);
    } catch (ExecutionException | TimeoutException e) {
      refuse(event, e);
    }
  }

  private void refuse(AsyncPlayerPreLoginEvent event, Exception cause) {
    runtime.report("checking bans at login", cause);
    event.disallow(
        AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
        Component.text("The Storm could not check its ban list. Please try again in a minute."));
  }
}
