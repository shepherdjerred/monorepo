package com.shepherdjerred.thestorm.core.snapshot;

import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.key.Key;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Taking a player's state into a snapshot, putting it back, and wiping it for a game. */
public final class PlayerStates {

  private static final int FULL_FOOD = 20;

  private PlayerStates() {}

  /** A snapshot of {@code player} right now, taken for {@code scope}. */
  public static Snapshot capture(Player player, String scope, Instant now) {
    var location = at(player);
    var contents =
        Arrays.stream(player.getInventory().getContents())
            .map(item -> item == null ? ItemStack.empty() : item)
            .toArray(ItemStack[]::new);
    var effects =
        player.getActivePotionEffects().stream()
            .map(
                effect ->
                    new EffectRecord(
                        effect.getType().getKey().asString(),
                        effect.getAmplifier(),
                        effect.getDuration(),
                        effect.isAmbient(),
                        effect.hasParticles(),
                        effect.hasIcon()))
            .toList();
    return new Snapshot(
        player.getUniqueId(),
        scope,
        new Position(
            player.getWorld().getName(),
            location.getX(),
            location.getY(),
            location.getZ(),
            location.getYaw(),
            location.getPitch()),
        new Vitals(
            player.getHealth(),
            player.getFoodLevel(),
            player.getSaturation(),
            player.getExhaustion(),
            player.getGameMode().name()),
        new Experience(
            player.getLevel(), Math.clamp(player.getExp(), 0f, 1f), player.getTotalExperience()),
        ItemData.of(ItemStack.serializeItemsAsBytes(contents)),
        effects,
        now);
  }

  /**
   * Puts {@code snapshot} back exactly. Returns false, having restored everything but the position,
   * if the snapshot's world no longer exists.
   */
  public static boolean apply(Player player, Snapshot snapshot, Server server) {
    player.setGameMode(GameMode.valueOf(snapshot.vitals().gameMode()));
    var position = snapshot.position();
    var world = server.getWorld(position.world());
    if (world != null) {
      player.teleport(
          new Location(
              world, position.x(), position.y(), position.z(), position.yaw(), position.pitch()));
    }
    player.getInventory().clear();
    player
        .getInventory()
        .setContents(ItemStack.deserializeItemsFromBytes(snapshot.inventory().bytes()));
    player.setLevel(snapshot.experience().level());
    player.setExp(snapshot.experience().progress());
    player.setTotalExperience(snapshot.experience().total());
    player.clearActivePotionEffects();
    player.addPotionEffects(effects(snapshot.effects()));
    var vitals = snapshot.vitals();
    player.setHealth(Math.min(vitals.health(), maxHealth(player)));
    player.setFoodLevel(vitals.food());
    player.setSaturation(vitals.saturation());
    player.setExhaustion(vitals.exhaustion());
    player.setFireTicks(0);
    return world != null;
  }

  /**
   * Closes the open inventory and moves the cursor into storage. Returns false, keeping any cursor
   * overflow with the player, when the inventory cannot hold it for a complete snapshot.
   */
  public static boolean settle(Player player) {
    var cursor = player.getItemOnCursor();
    player.setItemOnCursor(null);
    player.closeInventory();
    if (!cursor.isEmpty()) {
      var overflow = player.getInventory().addItem(cursor.clone());
      if (!overflow.isEmpty()) {
        player.setItemOnCursor(overflow.values().iterator().next());
        return false;
      }
    }
    return true;
  }

  /**
   * Closes whatever the player has open and throws away the item on their cursor: before they are
   * emptied or restored, whatever they hold there came from the arena.
   */
  public static void discardHeld(Player player) {
    player.closeInventory();
    player.setItemOnCursor(null);
  }

  /** Empties the player for the game: no items, effects or experience; full health and food. */
  public static void wipe(Player player, GameMode mode) {
    discardHeld(player);
    player.setGameMode(mode);
    player.getInventory().clear();
    player.clearActivePotionEffects();
    player.setLevel(0);
    player.setExp(0);
    player.setTotalExperience(0);
    heal(player);
  }

  public static void heal(Player player) {
    player.setHealth(maxHealth(player));
    player.setFoodLevel(FULL_FOOD);
    player.setSaturation(FULL_FOOD);
    player.setFireTicks(0);
  }

  /**
   * Where {@code entity} stands. Takes an {@link Entity} so a player resolves to its live position,
   * never {@code OfflinePlayer}'s nullable last-known one.
   */
  private static Location at(Entity entity) {
    return entity.getLocation();
  }

  private static double maxHealth(Player player) {
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException("players always have max health");
    }
    return attribute.getValue();
  }

  private static List<PotionEffect> effects(List<EffectRecord> records) {
    var effects = new ArrayList<PotionEffect>();
    for (var record : records) {
      Optional<PotionEffect> effect =
          effectType(record.type())
              .map(
                  type ->
                      new PotionEffect(
                          type,
                          record.duration(),
                          record.amplifier(),
                          record.ambient(),
                          record.particles(),
                          record.icon()));
      // An effect removed from the game since the snapshot was taken cannot be restored.
      effect.ifPresent(effects::add);
    }
    return effects;
  }

  /** The effect type for {@code key}, or empty if the server has none. */
  private static Optional<PotionEffectType> effectType(String key) {
    return Optional.ofNullable(
        RegistryAccess.registryAccess().getRegistry(RegistryKey.MOB_EFFECT).get(Key.key(key)));
  }
}
