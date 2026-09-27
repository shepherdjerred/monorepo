package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement.Cell;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import java.util.EnumSet;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Conversions between Paper blocks and grave positions, and what a block means for a grave. */
final class Blocks {

  /** Blocks nobody should stand in or have a grave in. */
  static final Set<Material> HAZARDS =
      EnumSet.of(
          Material.LAVA,
          Material.FIRE,
          Material.SOUL_FIRE,
          Material.CAMPFIRE,
          Material.SOUL_CAMPFIRE,
          Material.MAGMA_BLOCK,
          Material.CACTUS,
          Material.SWEET_BERRY_BUSH,
          Material.POWDER_SNOW,
          Material.WITHER_ROSE,
          Material.POINTED_DRIPSTONE,
          Material.COBWEB,
          Material.NETHER_PORTAL,
          Material.END_PORTAL,
          Material.END_GATEWAY);

  private Blocks() {}

  /**
   * Where {@code entity} is. Takes an {@link Entity} so a {@code Player} resolves to the entity's
   * non-null location rather than {@code OfflinePlayer}'s nullable one.
   */
  static Location at(Entity entity) {
    return entity.getLocation();
  }

  /** An inventory's storage slots; Paper never returns a null array, only null slots. */
  static @Nullable ItemStack[] storage(Inventory inventory) {
    return Objects.requireNonNull(inventory.getStorageContents());
  }

  /** Every slot of {@code player}'s inventory: storage, armor and offhand. */
  static @Nullable ItemStack[] contents(Player player) {
    return Objects.requireNonNull(player.getInventory().getContents());
  }

  static GravePos pos(Block block) {
    return new GravePos(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  /** The block at {@code pos}, if its world is loaded. */
  static Optional<Block> block(Server server, GravePos pos) {
    var world = server.getWorld(pos.world());
    return world == null
        ? Optional.empty()
        : Optional.of(world.getBlockAt(pos.x(), pos.y(), pos.z()));
  }

  /** Whether the chunk holding {@code pos} is loaded, so its blocks can be touched now. */
  static boolean isLoaded(Server server, GravePos pos) {
    var world = server.getWorld(pos.world());
    return world != null && world.isChunkLoaded(pos.x() >> 4, pos.z() >> 4);
  }

  /** The middle of the block at {@code pos}, for dropping items. */
  static Optional<Location> center(Server server, GravePos pos) {
    return block(server, pos).map(block -> block.getLocation().add(0.5, 0.5, 0.5));
  }

  /**
   * What {@code block} is for placing a grave, ignoring graves (the caller checks those). Only air
   * is open: a grave never replaces water, lava, light blocks, plants or anything else it could not
   * put back exactly.
   */
  static Cell cell(Block block) {
    var type = block.getType();
    if (HAZARDS.contains(type)) {
      return Cell.HAZARD;
    }
    if (type.isAir()) {
      return Cell.OPEN;
    }
    return type.isSolid() ? Cell.FLOOR : Cell.BLOCKED;
  }
}
