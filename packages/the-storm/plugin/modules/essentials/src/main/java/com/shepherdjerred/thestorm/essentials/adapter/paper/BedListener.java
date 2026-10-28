package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.HomeSignals;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.domain.home.Home;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeError;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import org.bukkit.Tag;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Right-clicking a bed saves the reserved bed home and the respawn point. Sleep is optional. */
final class BedListener implements Listener {
  private final PaperRuntime runtime;
  private final HomeStore homes;
  private final BedHomes beds;
  private final int limit;
  private final HomeSignals homesSaved;

  /** How many homes a player may keep, and who hears when a bed home is saved. */
  record Policy(int limit, HomeSignals saved) {}

  BedListener(PaperRuntime runtime, HomeStore homes, BedHomes beds, Policy policy) {
    this.runtime = runtime;
    this.homes = homes;
    this.beds = beds;
    this.limit = policy.limit();
    this.homesSaved = policy.saved();
  }

  @EventHandler
  void onJoin(PlayerJoinEvent event) {
    if (!Humans.isHuman(event.getPlayer())) return;
    var player = event.getPlayer();
    runtime.onMain(
        homes.homes(player.getUniqueId()),
        "loading a bed",
        found ->
            found.stream()
                .filter(home -> home.name().equals(HomeRules.BED))
                .findFirst()
                .ifPresent(
                    home -> {
                      if (player.isOnline()) beds.keep(player, home.position());
                    }));
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onBed(PlayerInteractEvent event) {
    if (event.getHand() != EquipmentSlot.HAND
        || event.getAction() != Action.RIGHT_CLICK_BLOCK
        || event.useInteractedBlock() == org.bukkit.event.Event.Result.DENY) return;
    var block = event.getClickedBlock();
    if (block == null || !Tag.BEDS.isTagged(block.getType())) return;
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) return;
    if (player.getWorld().isDayTime()) {
      event.setUseInteractedBlock(org.bukkit.event.Event.Result.DENY);
      event.setUseItemInHand(org.bukkit.event.Event.Result.DENY);
    }
    var spot = block.getLocation().add(0.5, 0, 0.5);
    spot.setYaw(Positions.current(player).getYaw());
    spot.setPitch(0);
    var position = Positions.of(spot);
    runtime.onMain(
        homes.set(player.getUniqueId(), new Home(HomeRules.BED, position), limit),
        "saving a bed",
        result -> {
          if (!player.isOnline()) return;
          switch (result) {
            case Result.Ok<HomeRules.Change, HomeError> ignored -> {
              beds.keep(player, position);
              Say.success(player, Say.HOMES, "Respawn point set.");
              homesSaved.saved(player.getUniqueId());
            }
            case Result.Err<HomeRules.Change, HomeError> ignored ->
                Say.error(player, Say.HOMES, "Could not save that respawn point.");
          }
        });
  }
}
