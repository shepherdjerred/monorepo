package com.shepherdjerred.thestorm.shards.app;

import java.util.OptionalInt;
import org.bukkit.inventory.ItemStack;

/**
 * Storm Shards for other modules, for example to hand out shards as a quest or arena reward.
 * Published through {@code context.services()}; call on the main thread.
 */
public interface StormShards {

  /** A new stack of {@code amount} shards (1 up to the material's stack size). */
  ItemStack create(int amount);

  /** Whether {@code item} is a Storm Shard (by its {@code thestorm:shard} key only). */
  boolean isShard(ItemStack item);

  /** The Storm tier (1 to 5) of {@code item}, or empty when it has never been upgraded. */
  OptionalInt stormTier(ItemStack item);
}
