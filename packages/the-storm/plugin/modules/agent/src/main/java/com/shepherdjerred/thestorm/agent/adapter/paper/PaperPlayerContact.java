package com.shepherdjerred.thestorm.agent.adapter.paper;

import com.shepherdjerred.thestorm.agent.app.PlayerContact;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Server;

/** {@link PlayerContact} on the main thread. */
public final class PaperPlayerContact implements PlayerContact {

  private final Server server;
  private final Scheduler scheduler;

  public PaperPlayerContact(Server server, Scheduler scheduler) {
    this.server = server;
    this.scheduler = scheduler;
  }

  @Override
  public CompletableFuture<Boolean> tell(UUID player, String text) {
    var done = new CompletableFuture<Boolean>();
    scheduler.runOnMainThread(
        () -> {
          var online = server.getPlayer(player);
          if (online == null) {
            done.complete(false);
            return;
          }
          online.sendMessage(Component.text(text));
          done.complete(true);
        });
    return done;
  }

  @Override
  public CompletableFuture<Boolean> kick(UUID player, String reason) {
    var done = new CompletableFuture<Boolean>();
    scheduler.runOnMainThread(
        () -> {
          var online = server.getPlayer(player);
          if (online == null) {
            done.complete(false);
            return;
          }
          online.kick(Component.text(reason));
          done.complete(true);
        });
    return done;
  }
}
