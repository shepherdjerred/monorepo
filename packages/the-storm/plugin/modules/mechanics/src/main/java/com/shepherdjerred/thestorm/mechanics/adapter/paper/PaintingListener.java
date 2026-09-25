package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.tools.Cycle;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.Comparator;
import org.bukkit.entity.Painting;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * The painting switcher: a Mechanic right-clicks a painting to show the next picture of the same
 * size, or sneak-right-clicks for the previous one.
 */
final class PaintingListener implements Listener {

  private final Kit kit;

  PaintingListener(Kit kit) {
    this.kit = kit;
  }

  @EventHandler(ignoreCancelled = true)
  void onInteract(PlayerInteractEntityEvent event) {
    if (event.getHand() != EquipmentSlot.HAND
        || !(event.getRightClicked() instanceof Painting painting)) {
      return;
    }
    var player = event.getPlayer();
    if (kit.gatekeeper().mayUse(Feature.PAINTING_SWITCHER, player::hasPermission).isPresent()) {
      return;
    }
    event.setCancelled(true);
    var grid = new PaperGrid(painting.getWorld());
    var entry =
        kit.guard()
            .check(
                player.getUniqueId(),
                ProtectedAction.INTERACT_ENTITY,
                grid,
                PaperGrid.feet(painting));
    if (entry instanceof Decision.Denied(var reason)) {
      Replies.error(player, Feature.PAINTING_SWITCHER, reason);
      return;
    }
    var current = painting.getArt();
    var registry = RegistryAccess.registryAccess().getRegistry(RegistryKey.PAINTING_VARIANT);
    var sameSize =
        registry.stream()
            .filter(
                art ->
                    art.getBlockWidth() == current.getBlockWidth()
                        && art.getBlockHeight() == current.getBlockHeight())
            .sorted(Comparator.comparing(art -> registry.getKeyOrThrow(art).asString()))
            .toList();
    var next = Cycle.step(sameSize, current, !player.isSneaking());
    if (next.isEmpty() || !painting.setArt(next.orElseThrow(), false)) {
      Replies.error(player, Feature.PAINTING_SWITCHER, "No other picture fits here.");
    }
  }
}
