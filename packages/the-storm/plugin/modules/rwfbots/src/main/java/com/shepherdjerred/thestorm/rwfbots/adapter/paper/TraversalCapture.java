package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.KitMovement;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;

/** Captures real survival modifiers and actionable healing inventory on the main thread. */
public final class TraversalCapture {
  private final Function<UUID, Optional<Instant>> noFallUntil;
  private final InstantSource time;

  public TraversalCapture(Function<UUID, Optional<Instant>> noFallUntil, InstantSource time) {
    this.noFallUntil = noFallUntil;
    this.time = time;
  }

  TraversalState capture(Player player, String realKit, long tick) {
    return capture(player, KitMovement.maySprint(realKit) && player.getFoodLevel() > 6, tick);
  }

  /** The final physical gate reads actual fall modifiers without guessing a kit from its items. */
  public TraversalState survival(Player player, long tick) {
    return capture(player, player.getFoodLevel() > 6, tick);
  }

  private TraversalState capture(Player player, boolean maySprint, long tick) {
    var resistance = player.getPotionEffect(PotionEffectType.RESISTANCE);
    var regeneration = player.getPotionEffect(PotionEffectType.REGENERATION);
    var slowFalling = player.getPotionEffect(PotionEffectType.SLOW_FALLING);
    var jumpBoost = player.getPotionEffect(PotionEffectType.JUMP_BOOST);
    var multiplier = attribute(player, Attribute.FALL_DAMAGE_MULTIPLIER);
    return new TraversalState(
        maySprint,
        attribute(player, Attribute.SAFE_FALL_DISTANCE),
        multiplier,
        protection(player),
        amplifier(resistance),
        untilTick(resistance, tick),
        immunity(player, multiplier, tick),
        untilTick(slowFalling, tick),
        healing(player),
        amplifier(regeneration),
        untilTick(regeneration, tick),
        amplifier(jumpBoost),
        untilTick(jumpBoost, tick),
        attribute(player, Attribute.MAX_HEALTH),
        player.getFallDistance());
  }

  private long immunity(Player player, double multiplier, long tick) {
    if (multiplier == 0) return Long.MAX_VALUE;
    return noFallUntil
        .apply(player.getUniqueId())
        .map(until -> expiry(time.instant(), until, tick))
        .orElse(-1L);
  }

  private static double attribute(Player player, Attribute key) {
    var value = player.getAttribute(key);
    if (value == null)
      throw new IllegalStateException("Players must have traversal attribute " + key);
    return value.getValue();
  }

  private static int protection(Player player) {
    var inventory = player.getInventory();
    return Math.clamp(
        protectionPoints(inventory.getHelmet())
            + protectionPoints(inventory.getChestplate())
            + protectionPoints(inventory.getLeggings())
            + protectionPoints(inventory.getBoots()),
        0,
        20);
  }

  private static int protectionPoints(@Nullable ItemStack armor) {
    return armor == null
        ? 0
        : armor.getEnchantmentLevel(Enchantment.PROTECTION)
            + 3 * armor.getEnchantmentLevel(Enchantment.FEATHER_FALLING);
  }

  /** Only the hotbar consumables supported by the actual CombatantActions.consume port count. */
  private static int healing(Player player) {
    var count = 0;
    for (var slot = 0; slot < 9; slot++) {
      var item = player.getInventory().getItem(slot);
      if (item != null
          && (item.getType() == Material.COOKED_BEEF || item.getType() == Material.GOLDEN_APPLE))
        count += item.getAmount();
    }
    return count;
  }

  private static int amplifier(@Nullable PotionEffect effect) {
    return effect == null ? -1 : effect.getAmplifier();
  }

  private static long untilTick(@Nullable PotionEffect effect, long tick) {
    if (effect == null) return -1;
    return effect.isInfinite()
        ? Long.MAX_VALUE
        : Math.addExact(tick, Math.max(0, effect.getDuration()));
  }

  /** Round wall-time immunity down so it is never credited beyond its actual expiry. */
  static long expiry(Instant now, Instant until, long tick) {
    if (until.equals(Instant.MAX)) return Long.MAX_VALUE;
    if (!until.isAfter(now)) return -1;
    var remaining = Duration.between(now, until);
    return Math.addExact(tick, remaining.toMillis() / 50);
  }
}
