package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.domain.Bonuses;
import com.shepherdjerred.thestorm.shards.domain.GearCategory;
import com.shepherdjerred.thestorm.shards.domain.StormPiece;
import com.shepherdjerred.thestorm.shards.domain.StormTier;
import io.papermc.paper.datacomponent.DataComponentTypes;
import java.util.ArrayList;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;

/**
 * Reads and writes an item's Storm tier. The tier lives in the item's {@code thestorm:storm_tier}
 * persistent data; the "Storm III" lore line and the glint are presentation only.
 */
final class StormGear {

  private final NamespacedKey tierKey;
  private final Bonuses bonuses;
  private final ShardText text;

  StormGear(NamespacedKey tierKey, Bonuses bonuses, ShardText text) {
    this.tierKey = tierKey;
    this.bonuses = bonuses;
    this.text = text;
  }

  /** The upgradeable category of {@code item}, or empty. */
  Optional<GearCategory> categoryOf(@Nullable ItemStack item) {
    if (item == null || item.isEmpty()) {
      return Optional.empty();
    }
    return bonuses.categoryOf(item.getType().name());
  }

  /**
   * The Storm tier of {@code item}, or empty when it has none. A stored value outside Storm I to V
   * is corrupt data and throws.
   */
  Optional<StormTier> tierOf(@Nullable ItemStack item) {
    if (item == null || item.isEmpty()) {
      return Optional.empty();
    }
    var level = item.getPersistentDataContainer().get(tierKey, PersistentDataType.INTEGER);
    return level == null ? Optional.empty() : Optional.of(new StormTier(level));
  }

  /** The item as a Storm piece: upgradeable gear that has a tier. */
  Optional<StormPiece> pieceOf(@Nullable ItemStack item) {
    var category = categoryOf(item);
    if (category.isEmpty()) {
      return Optional.empty();
    }
    return tierOf(item).map(tier -> new StormPiece(category.get(), tier));
  }

  /** Stores {@code tier} on {@code item}, replaces its Storm lore line and adds the glint. */
  void apply(ItemStack item, StormTier tier) {
    item.editPersistentDataContainer(
        pdc -> pdc.set(tierKey, PersistentDataType.INTEGER, tier.level()));
    var existing = item.lore();
    var lore = new ArrayList<Component>();
    lore.add(text.loreLine(tier));
    if (existing != null) {
      existing.stream().filter(line -> !text.isLoreLine(line)).forEach(lore::add);
    }
    item.lore(lore);
    item.setData(DataComponentTypes.ENCHANTMENT_GLINT_OVERRIDE, true);
  }
}
