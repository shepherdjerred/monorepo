package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.shards.domain.BlockBreak;
import com.shepherdjerred.thestorm.shards.domain.DropOutcome;
import com.shepherdjerred.thestorm.shards.domain.MobKill;
import com.shepherdjerred.thestorm.shards.domain.ShardDrops;
import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityTransformEvent;
import org.bukkit.event.world.ChunkPopulateEvent;
import org.bukkit.persistence.PersistentDataType;

/**
 * Drops shards from mob kills and ore breaks, and tracks player-placed ore so it never drops. Drops
 * run at {@link EventPriority#MONITOR} so protection plugins have already cancelled denied breaks.
 */
final class DropListener implements Listener {

  private final ShardDrops drops;
  private final PlacedBlocks placed;
  private final ShardItems shards;
  private final ShardText text;
  private final RandomGenerator random;
  private final ProvenanceKeys keys;
  private final SealedWorlds sealed;

  record ProvenanceKeys(NamespacedKey excludedOrigin, NamespacedKey freshChunk) {}

  DropListener(ShardDrops drops, PlacedBlocks placed, ShardKit kit, ProvenanceKeys keys) {
    this.drops = drops;
    this.placed = placed;
    this.shards = kit.shards();
    this.text = kit.text();
    this.random = kit.random();
    this.sealed = kit.sealed();
    this.keys = keys;
  }

  /**
   * Existing chunks contain ores placed before placement tracking existed. Only chunks generated
   * while drops are active can have ore provenance trusted for a shard roll.
   */
  @EventHandler
  void onPopulate(ChunkPopulateEvent event) {
    event
        .getChunk()
        .getPersistentDataContainer()
        .set(keys.freshChunk(), PersistentDataType.BYTE, (byte) 1);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onTransform(EntityTransformEvent event) {
    if (!(event.getEntity() instanceof LivingEntity source)
        || (!drops.isExcludedSpawnReason(spawnReason(source)) && !hasExcludedOrigin(source))) {
      return;
    }
    for (var transformed : event.getTransformedEntities()) {
      transformed
          .getPersistentDataContainer()
          .set(keys.excludedOrigin(), PersistentDataType.BYTE, (byte) 1);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    var block = event.getBlockPlaced();
    if (drops.isBlockSource(block.getType().name())) {
      placed.markPlaced(block);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    markMoved(event.getBlocks(), event.getDirection());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    markMoved(event.getBlocks(), event.getDirection());
  }

  /**
   * A piston could launder a placed ore into an unmarked position, so any source block a piston
   * moves counts as placed. Both neighbours along the axis are marked because the retract event's
   * direction is not the direction of travel on every server version; over-marking only costs a
   * natural ore its roll.
   */
  private void markMoved(List<Block> moved, BlockFace direction) {
    for (var block : moved) {
      if (drops.isBlockSource(block.getType().name())) {
        placed.markPlaced(block.getRelative(direction));
        placed.markPlaced(block.getRelative(direction.getOppositeFace()));
      }
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    var block = event.getBlock();
    var material = block.getType().name();
    if (!drops.isBlockSource(material)) {
      return;
    }
    var player = event.getPlayer();
    var tool = player.getInventory().getItemInMainHand();
    var wasPlaced = placed.isPlaced(block);
    placed.clear(block);
    if (sealed.isSealed(block.getWorld())) {
      return;
    }
    if (!block
        .getChunk()
        .getPersistentDataContainer()
        .has(keys.freshChunk(), PersistentDataType.BYTE)) {
      return;
    }
    var broken =
        new BlockBreak(
            material,
            block.getWorld().getKey().asString(),
            wasPlaced,
            tool.containsEnchantment(Enchantment.SILK_TOUCH),
            event.isDropItems()
                && player.getGameMode() != GameMode.CREATIVE
                && !block.getDrops(tool, player).isEmpty());
    if (drops.evaluate(broken, random) instanceof DropOutcome.Dropped(var amount)) {
      drop(block.getLocation().toCenterLocation(), amount, player);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDeath(EntityDeathEvent event) {
    var entity = event.getEntity();
    var type = entity.getType().name();
    if (!drops.isMobSource(type)) {
      return;
    }
    if (hasExcludedOrigin(entity) || sealed.isSealed(entity.getWorld())) {
      return;
    }
    var killer = entity.getKiller();
    var kill =
        new MobKill(
            type, entity.getWorld().getKey().asString(), spawnReason(entity), killer != null);
    if (killer != null && drops.evaluate(kill, random) instanceof DropOutcome.Dropped(var amount)) {
      event.getDrops().add(shards.create(amount));
      flourish(entity.getLocation(), amount, killer);
    }
  }

  /** Paper's own {@code DEFAULT} marks an entity whose spawn reason was never recorded. */
  private static String spawnReason(LivingEntity entity) {
    var reason = entity.getEntitySpawnReason();
    return (reason == null ? SpawnReason.DEFAULT : reason).name();
  }

  private boolean hasExcludedOrigin(LivingEntity entity) {
    return entity.getPersistentDataContainer().has(keys.excludedOrigin(), PersistentDataType.BYTE);
  }

  private void drop(Location location, int amount, Player finder) {
    location.getWorld().dropItemNaturally(location, shards.create(amount));
    flourish(location, amount, finder);
  }

  /** The original's fire-particle burst, plus a note to the finder. */
  private void flourish(Location location, int amount, Player finder) {
    location.getWorld().spawnParticle(Particle.FLAME, location, 16, 0.3, 0.3, 0.3, 0.02);
    text.success(finder, text.messages().found(), ShardText.number("amount", amount));
  }
}
