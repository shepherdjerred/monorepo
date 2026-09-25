package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Experience;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Position;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Vitals;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;

/** Taking a player's state into a snapshot, putting it back, and wiping it for the arena. */
final class PlayerStates {

  private static final int FULL_FOOD = 20;

  private PlayerStates() {}

  static Snapshot capture(Player player, String arena, Instant now) {
    var location = Places.at(player);
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
        arena,
        new Position(
            location.getWorld().getName(),
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
  static boolean apply(Player player, Snapshot snapshot, Server server) {
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

  /** Empties the player for the arena: no items, effects or experience; full health and food. */
  static void wipe(Player player, GameMode mode) {
    player.setGameMode(mode);
    player.getInventory().clear();
    player.clearActivePotionEffects();
    player.setLevel(0);
    player.setExp(0);
    player.setTotalExperience(0);
    heal(player);
  }

  static void heal(Player player) {
    player.setHealth(maxHealth(player));
    player.setFoodLevel(FULL_FOOD);
    player.setSaturation(FULL_FOOD);
    player.setFireTicks(0);
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
          ItemFactory.effect(record.type())
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
}
