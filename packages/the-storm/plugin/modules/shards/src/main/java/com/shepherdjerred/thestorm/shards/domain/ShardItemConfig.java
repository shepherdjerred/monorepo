package com.shepherdjerred.thestorm.shards.domain;

import java.util.List;

/**
 * How a Storm Shard looks. A shard is recognised only by its {@code thestorm:shard} persistent data
 * key, never by these values, so changing them never orphans existing shards.
 *
 * @param material the base Paper item material
 * @param name the MiniMessage item name
 * @param lore MiniMessage lore lines
 * @param itemModel the {@code item_model} key; the vanilla model until the resource pack ships one
 * @param glint whether the shard shows the enchantment glint
 */
public record ShardItemConfig(
    String material, String name, List<String> lore, String itemModel, boolean glint) {

  public ShardItemConfig {
    lore = List.copyOf(lore);
    Checks.constant("item.material", material);
    Checks.notBlank("item.name", name);
    Checks.key("item.itemModel", itemModel);
  }
}
