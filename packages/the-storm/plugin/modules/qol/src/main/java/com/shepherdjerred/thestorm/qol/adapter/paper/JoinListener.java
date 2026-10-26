package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.essentials.app.NewcomerPlacements;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Shows the biome dialog the first time this module sees a player. */
final class JoinListener implements Listener {

  private final QolStore store;
  private final ArrivalDialog dialog;
  private final ModuleContext context;
  private final StarterCompass compass;
  private final NewcomerPlacements placements;

  JoinListener(
      QolStore store, ArrivalDialog dialog, ModuleContext context, StarterCompass compass) {
    this.store = store;
    this.dialog = dialog;
    this.context = context;
    this.compass = compass;
    this.placements = context.services().require(NewcomerPlacements.class);
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
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
                  if (!player.isOnline()) return;
                  compass.loaded(player, ensured.profile().starterRtpCharges());
                  if (ensured.created() && compass.pending(player)) {
                    if (player.hasPlayedBefore()) dialog.show(player);
                    else placements.whenReady(player, dialog::show);
                  }
                },
                context.scheduler().mainThread());
  }
}
