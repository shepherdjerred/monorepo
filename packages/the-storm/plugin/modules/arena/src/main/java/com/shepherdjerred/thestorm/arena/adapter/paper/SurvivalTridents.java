package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.entity.Trident;
import org.bukkit.inventory.ItemStack;

/** A thrown item reserves its source slot until exactly one metadata-preserving return. */
final class SurvivalTridents {
  private record Flight(UUID owner, UUID identity, int slot, ItemStack item, Instant inspect) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Flight> flights = new HashMap<>();
  private final java.util.Set<UUID> pending = new java.util.HashSet<>();

  SurvivalTridents(SurvivalRunner runner) {
    this.runner = runner;
  }

  void launched(Player player, Trident trident) {
    var item = trident.getItemStack();
    if (!runner.items().equipment(item)) return;
    var identity = runner.items().identity(item);
    var slot = player.getInventory().getHeldItemSlot();
    if (same(player.getInventory().getItemInOffHand(), identity)) slot = 40;
    flights.put(
        trident.getUniqueId(),
        new Flight(
            player.getUniqueId(),
            identity,
            slot,
            item.clone(),
            runner.context().time().instant().plusMillis(150)));
    runner.items().reserveSlot(player.getUniqueId(), slot);
    runner.items().reserveWeapon(player.getUniqueId(), identity);
  }

  private boolean same(ItemStack item, UUID identity) {
    return runner.items().equipment(item) && runner.items().identity(item).equals(identity);
  }

  boolean pickup(Player player, Trident trident) {
    var flight = flights.get(trident.getUniqueId());
    if (flight == null) return false;
    if (flight.owner().equals(player.getUniqueId())) force(trident);
    return true;
  }

  void force(Trident trident) {
    var id = trident.getUniqueId();
    var flight = flights.get(id);
    if (flight == null) return;
    flights.put(
        id,
        new Flight(
            flight.owner(),
            flight.identity(),
            flight.slot(),
            trident.getItemStack().clone(),
            flight.inspect()));
    pending.add(id);
    trident.remove();
    attempt(id);
  }

  void tick() {
    var now = runner.context().time().instant();
    for (var id : List.copyOf(flights.keySet())) {
      var flight = java.util.Objects.requireNonNull(flights.get(id));
      if (now.isBefore(flight.inspect())) continue;
      var owner = runner.context().server().getPlayer(flight.owner());
      if (owner == null) continue;
      var entity = runner.context().server().getEntity(id);
      if (pending.contains(id) || entity == null || contains(owner, flight.identity())) attempt(id);
      else if (entity instanceof Trident trident
          && trident.getLoyaltyLevel() > 0
          && trident.hasDealtDamage()
          && Places.at(owner).distanceSquared(trident.getLocation()) < 4) force(trident);
    }
  }

  private boolean contains(Player player, UUID identity) {
    return java.util.Arrays.stream(player.getInventory().getContents())
        .anyMatch(item -> item != null && same(item, identity));
  }

  private void attempt(UUID id) {
    var flight = flights.get(id);
    if (flight == null) return;
    var owner = runner.context().server().getPlayer(flight.owner());
    if (owner == null) return;
    var inventory = owner.getInventory();
    var existing = inventory.getItem(flight.slot());
    if (existing != null && !existing.isEmpty() && !same(existing, flight.identity())) {
      inventory.setItem(flight.slot(), null);
      if (!runner.items().deliver(owner, List.of(existing))) {
        inventory.setItem(flight.slot(), existing);
        pending.add(id);
        return;
      }
    }
    var returned = flight.item();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && same(item, flight.identity())) {
        returned = item.clone();
        inventory.setItem(slot, null);
      }
    }
    inventory.setItem(flight.slot(), returned);
    var projectile = runner.context().server().getEntity(id);
    if (projectile != null) projectile.remove();
    flights.remove(id);
    pending.remove(id);
    runner.items().releaseSlot(flight.owner(), flight.slot());
    runner.items().releaseWeapon(flight.owner(), flight.identity());
  }

  void leave(UUID owner) {
    for (var id : List.copyOf(flights.keySet())) {
      var flight = java.util.Objects.requireNonNull(flights.get(id));
      if (!flight.owner().equals(owner)) continue;
      runner.items().releaseSlot(owner, flight.slot());
      runner.items().releaseWeapon(owner, flight.identity());
      var entity = runner.context().server().getEntity(id);
      if (entity != null) entity.remove();
      flights.remove(id);
      pending.remove(id);
    }
  }
}
