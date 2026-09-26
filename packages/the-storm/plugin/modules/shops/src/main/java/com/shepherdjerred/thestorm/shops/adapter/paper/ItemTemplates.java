package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.block.Container;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.BlockStateMeta;
import org.bukkit.inventory.meta.BundleMeta;

/**
 * Turns items into shop fingerprints and back. The fingerprint is the whole one-item stack
 * serialized with every component, so an enchanted or renamed item is a different item from a plain
 * one; matching uses {@link ItemStack#isSimilar}, which ignores only the amount.
 */
public final class ItemTemplates {

  private final Map<String, ItemStack> decoded = new HashMap<>();

  /** The fingerprint of {@code item}; the amount does not matter. */
  public ItemFingerprint fingerprint(ItemStack item) {
    if (item.getType().isAir() || item.getAmount() < 1) {
      throw new IllegalArgumentException("air has no fingerprint");
    }
    var one = item.asOne();
    var encoded = Base64.getEncoder().encodeToString(one.serializeAsBytes());
    decoded.putIfAbsent(encoded, one.clone());
    return new ItemFingerprint(
        key(item.getType()), encoded, !one.isSimilar(ItemStack.of(item.getType())));
  }

  /** A one-item stack of a plain material, as named on a sign or in a catalog. */
  public ItemFingerprint plain(Material material) {
    return fingerprint(ItemStack.of(material));
  }

  /** The one-item template a fingerprint describes. Callers must not change it. */
  public ItemStack template(ItemFingerprint fingerprint) {
    return decoded
        .computeIfAbsent(
            fingerprint.template(),
            encoded -> ItemStack.deserializeBytes(Base64.getDecoder().decode(encoded)))
        .clone();
  }

  /** Whether {@code item} is the fingerprinted item, in any amount. */
  public boolean matches(ItemFingerprint fingerprint, ItemStack item) {
    return !item.getType().isAir() && template(fingerprint).isSimilar(item);
  }

  /** Whether {@code item} carries other items: a filled shulker box, bundle or other container. */
  public static boolean holdsItems(ItemStack item) {
    if (!item.hasItemMeta()) {
      return false;
    }
    var meta = item.getItemMeta();
    if (meta instanceof BundleMeta bundle) {
      return bundle.hasItems();
    }
    return meta instanceof BlockStateMeta states
        && states.hasBlockState()
        && states.getBlockState() instanceof Container container
        && !container.getInventory().isEmpty();
  }

  /** The item key used in storage and messages: {@code diamond_sword}. */
  public static String key(Material material) {
    return material.getKey().getKey();
  }

  /**
   * The item named by a key or a sign's text: {@code coal}, {@code minecraft:coal}, {@code Oak
   * Log}.
   */
  public static Optional<Material> item(String name) {
    var material = Material.matchMaterial(name.strip());
    return material != null && material.isItem() && !material.isAir()
        ? Optional.of(material)
        : Optional.empty();
  }
}
