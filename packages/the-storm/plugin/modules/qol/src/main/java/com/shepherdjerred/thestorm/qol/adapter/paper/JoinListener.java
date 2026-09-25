package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Shows the biome dialog the first time this module sees a player. */
final class JoinListener implements Listener {

  private final QolStore store;
  private final ArrivalDialog dialog;
  private final ModuleContext context;

  JoinListener(QolStore store, ArrivalDialog dialog, ModuleContext context) {
    this.store = store;
    this.dialog = dialog;
    this.context = context;
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    var _ =
        store
            .ensure(player.getUniqueId(), context.time().instant())
            .whenCompleteAsync(
                (ensured, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not remember {}", player.getName(), failure);
                    return;
                  }
                  if (ensured.created() && player.isOnline()) {
                    dialog.show(player);
                  }
                },
                context.scheduler().mainThread());
  }
}
