package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Native held-use state drives a four-shot-per-second bow with one carried arrow per shot. */
final class RepeaterCombat {
  private record Firing(int slot, ItemStack weapon, java.time.Instant ready) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Firing> firing = new HashMap<>();
  private @Nullable Cancellable task;

  RepeaterCombat(SurvivalRunner runner) {
    this.runner = runner;
  }

  boolean owns(ItemStack weapon) {
    return runner
        .items()
        .legendary(weapon)
        .filter(id -> id == LegendaryWeapon.REPEATER)
        .isPresent();
  }

  void begin(Player player) {
    var weapon = player.getInventory().getItemInMainHand();
    if (!runner.isFighter(player.getUniqueId()) || !owns(weapon)) return;
    firing.put(
        player.getUniqueId(),
        new Firing(
            player.getInventory().getHeldItemSlot(),
            weapon.clone(),
            runner.context().time().instant()));
    // Poll each tick: a five-tick callback can arrive just before the wall-clock deadline.
    if (task == null)
      task =
          runner
              .context()
              .scheduler()
              .repeatOnMainThread(Duration.ofMillis(50), Duration.ofMillis(50), this::pulse);
  }

  private void pulse() {
    for (var id : List.copyOf(firing.keySet())) {
      var player = runner.context().server().getPlayer(id);
      var use = java.util.Objects.requireNonNull(firing.get(id));
      if (player == null || !held(player, use)) stop(id);
      else if (!runner.context().time().instant().isBefore(use.ready())) fire(player);
    }
  }

  private boolean held(Player player, Firing use) {
    return runner.isFighter(player.getUniqueId())
        && player.isOnline()
        && player.isHandRaised()
        && player.getInventory().getHeldItemSlot() == use.slot()
        && player.getInventory().getItemInMainHand().isSimilar(use.weapon())
        && runner.items().count(player, Material.ARROW) > 0;
  }

  private void fire(Player player) {
    var payment = runner.items().reserve(player, Map.of("ARROW", 1)).orElseThrow();
    var weapon = player.getInventory().getItemInMainHand();
    var arrow =
        player.launchProjectile(Arrow.class, player.getEyeLocation().getDirection().multiply(3));
    if (!arrow.isValid()) {
      runner.items().refund(player, payment);
      stop(player.getUniqueId());
      return;
    }
    runner.items().commit(payment);
    arrow.setDamage(2 + weapon.getEnchantmentLevel(Enchantment.POWER) * .5);
    arrow.setCritical(false);
    arrow.setPickupStatus(AbstractArrow.PickupStatus.DISALLOWED);
    var factor = runner.items().multiplier(weapon);
    if (runner.game().player(player.getUniqueId()).orElseThrow().role() == SurvivalClass.RANGER)
      factor *= 1.1;
    if (runner.actions().has(player, SurvivalPerk.DOUBLE_TAP)) factor *= 1.25;
    factor *= runner.talents().shot(player, arrow);
    runner.combat().projectile(arrow, factor);
    runner.legendary().launched(arrow, weapon);
    player.damageItemStack(EquipmentSlot.HAND, 1);
    firing.put(
        player.getUniqueId(),
        new Firing(
            player.getInventory().getHeldItemSlot(),
            player.getInventory().getItemInMainHand().clone(),
            runner.context().time().instant().plusMillis(250)));
    player.playSound(Places.at(player), Sound.ENTITY_ARROW_SHOOT, .5f, 1.3f);
  }

  void stop(UUID id) {
    firing.remove(id);
    if (firing.isEmpty() && task != null) {
      task.cancel();
      task = null;
    }
  }

  void cancelVanilla(org.bukkit.event.entity.EntityShootBowEvent event, Player player) {
    event.setCancelled(true);
    stop(player.getUniqueId());
    var bow = java.util.Objects.requireNonNull(event.getBow());
    var arrow = event.getConsumable();
    // Paper draws ammunition before firing this event; cancellation alone cannot return it.
    if (arrow != null
        && event.shouldConsumeItem()
        && bow.getEnchantmentLevel(Enchantment.INFINITY) == 0
        && player.getGameMode() != org.bukkit.GameMode.CREATIVE
        && !runner.items().deliver(player, List.of(arrow.asQuantity(1))))
      throw new IllegalStateException("Cancelled bow ammunition could not be restored");
  }

  void reset() {
    firing.clear();
    if (task != null) {
      task.cancel();
      task = null;
    }
  }
}
