package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.Nicknames;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import java.time.Duration;

/** Writes where each online player is, once a minute, so a session can be read from the console. */
public final class PresenceLog {

  private final ModuleContext context;
  private final Cancellable task;

  public PresenceLog(ModuleContext context) {
    this.context = context;
    task =
        context
            .scheduler()
            .repeatOnMainThread(Duration.ofSeconds(60), Duration.ofSeconds(60), this::sample);
  }

  void sample() {
    for (var player : context.plugin().getServer().getOnlinePlayers()) {
      if (!Humans.isHuman(player)) continue;
      var at = player.getLocation();
      if (at.getWorld() == null) continue;
      var nick =
          context
              .services()
              .find(Nicknames.class)
              .map(names -> names.display(player.getUniqueId(), player.getName()))
              .orElseGet(player::getName);
      context.logger().info("{}", PlayLog.position(player.getName(), at, nick));
    }
  }

  public void close() {
    task.cancel();
  }
}
