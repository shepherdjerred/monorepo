package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Acrobat;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Alchemist;
import org.bukkit.Material;
import org.bukkit.entity.Entity;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.entity.PotionSplashEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Human kit actions share the same inputs as bot kit-item uses. */
final class ExpansionKitListener implements Listener {
  private final MatchRunner runner;
  private final Keys keys;

  ExpansionKitListener(MatchRunner runner, Keys keys) {
    this.runner = runner;
    this.keys = keys;
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void use(PlayerInteractEvent event) {
    var player = event.getPlayer();
    var item = event.getItem();
    if (event.getHand() == EquipmentSlot.OFF_HAND
        || item == null
        || !event.getAction().isRightClick()
        || !runner.fighting(player.getUniqueId())
        || !keys.isKitItem(item)) return;
    var kit = runner.memberOf(player.getUniqueId()).flatMap(member -> member.kit()).orElse("");
    if (kit.equals(Acrobat.ID) && item.getType() == Material.FEATHER) {
      event.setUseItemInHand(Event.Result.DENY);
      event.setUseInteractedBlock(Event.Result.DENY);
      runner
          .kits()
          .act(
              player,
              new ExpansionInput.AirJump(
                  !((Entity) player).isOnGround(), player.getVelocity().getY()));
    } else if (kit.equals(Alchemist.ID) && item.getType() == Material.SPLASH_POTION) {
      event.setUseItemInHand(Event.Result.DENY);
      event.setUseInteractedBlock(Event.Result.DENY);
      runner.kits().act(player, new ExpansionInput.ThrowFlask());
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void shot(EntityShootBowEvent event) {
    runner.powers().expansion().shot(event);
  }

  @EventHandler(priority = EventPriority.HIGH)
  void splash(PotionSplashEvent event) {
    runner.powers().expansion().splash(event);
  }
}
