package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.DoubleChests;
import com.shepherdjerred.thestorm.shops.domain.shop.Facing;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLines;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.Chest;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * Where shops are in the world: signs and the containers they hang on, both halves of double
 * chests, and the shop id each shop sign carries in its persistent data.
 */
public final class ShopBlocks {

  private final Server server;
  private final ShopRegistry registry;
  private final Set<Material> containers;
  private final NamespacedKey shopIdKey;
  private final NamespacedKey itemKey;

  public ShopBlocks(Plugin plugin, ShopRegistry registry, Set<Material> containers) {
    this.server = plugin.getServer();
    this.registry = registry;
    this.containers = Set.copyOf(containers);
    this.shopIdKey = new NamespacedKey(plugin, "shop_id");
    this.itemKey = new NamespacedKey(plugin, "shop_item");
  }

  public ShopRegistry registry() {
    return registry;
  }

  /** Where an online player stands. Paper marks the getter nullable; it is set for a player. */
  public static Location locationOf(Player player) {
    return Objects.requireNonNull(player.getLocation(), "an online player has a location");
  }

  public static BlockPos pos(Block block) {
    return new BlockPos(block.getWorld().getUID(), block.getX(), block.getY(), block.getZ());
  }

  public Optional<Block> block(BlockPos pos) {
    var world = server.getWorld(pos.world());
    return world == null
        ? Optional.empty()
        : Optional.of(world.getBlockAt(pos.x(), pos.y(), pos.z()));
  }

  public Optional<Location> center(BlockPos pos) {
    return block(pos).map(block -> block.getLocation().toCenterLocation());
  }

  /**
   * The block a shop sign hangs on: behind a wall sign, below a standing sign. Hanging signs are
   * never shop signs.
   */
  public static Optional<Block> supportOf(Block sign) {
    var data = sign.getBlockData();
    if (data instanceof WallSign wall) {
      return Optional.of(sign.getRelative(wall.getFacing().getOppositeFace()));
    }
    if (data instanceof org.bukkit.block.data.type.Sign) {
      return Optional.of(sign.getRelative(BlockFace.DOWN));
    }
    return Optional.empty();
  }

  /** Whether chest shops may trade from this block. */
  public boolean isShopContainer(Block block) {
    return containers.contains(block.getType()) && block.getState(false) instanceof Container;
  }

  /** The container's blocks: itself, and the other half of a double chest. */
  public static List<BlockPos> containerBlocks(Block container) {
    var blocks = new ArrayList<BlockPos>(2);
    blocks.add(pos(container));
    otherHalf(container).ifPresent(blocks::add);
    return List.copyOf(blocks);
  }

  private static Optional<BlockPos> otherHalf(Block block) {
    if (!(block.getBlockData() instanceof Chest chest)) {
      return Optional.empty();
    }
    var half =
        switch (chest.getType()) {
          case SINGLE -> DoubleChests.Half.SINGLE;
          case LEFT -> DoubleChests.Half.LEFT;
          case RIGHT -> DoubleChests.Half.RIGHT;
        };
    return facing(chest.getFacing())
        .flatMap(facing -> DoubleChests.otherHalf(pos(block), facing, half));
  }

  private static Optional<Facing> facing(BlockFace face) {
    return switch (face) {
      case NORTH -> Optional.of(Facing.NORTH);
      case EAST -> Optional.of(Facing.EAST);
      case SOUTH -> Optional.of(Facing.SOUTH);
      case WEST -> Optional.of(Facing.WEST);
      default -> Optional.empty();
    };
  }

  /** The shops trading from this block or, for a double chest, from either half. */
  public List<SignShop> shopsOnContainer(Block block) {
    return containerBlocks(block).stream()
        .flatMap(pos -> registry.tradingFrom(pos).stream())
        .distinct()
        .toList();
  }

  /**
   * The shops an inventory belongs to. Read from the inventory's location, which needs no block
   * state snapshot (hoppers ask on every move); a double chest reports a point between its halves
   * that falls in one of them, and {@link #shopsOnContainer} covers the other.
   */
  public List<SignShop> shopsOwning(Inventory inventory) {
    var location = inventory.getLocation();
    return location == null ? List.of() : shopsOnContainer(location.getBlock());
  }

  /** Every shop a broken, burnt or exploded block belongs to, as sign or container. */
  public List<SignShop> shopsAt(Block block) {
    var shops = new ArrayList<SignShop>();
    registry.atSign(pos(block)).ifPresent(shops::add);
    shops.addAll(shopsOnContainer(block));
    return shops.stream().distinct().toList();
  }

  /** The shop whose sign this is, if the sign still carries that shop's id. */
  public Optional<SignShop> shopAtSign(Block block) {
    // The registry lookup is cheap; read the block state only for a registered sign.
    var shop = registry.atSign(pos(block));
    if (shop.isEmpty() || !(block.getState(false) instanceof Sign sign)) {
      return Optional.empty();
    }
    var id = sign.getPersistentDataContainer().get(shopIdKey, PersistentDataType.LONG);
    return shop.filter(found -> id != null && found.id() == id);
  }

  /**
   * Stamps a sign with its shop's id and item fingerprint.
   *
   * @return false if the block is no longer a sign
   */
  public boolean stamp(Block block, SignShop shop) {
    if (!(block.getState(false) instanceof Sign)) {
      return false;
    }
    write(block, shop, Optional.empty());
    return true;
  }

  /** Rewrites a shop sign's lines and stamps it. */
  public void rewrite(Block block, SignShop shop, SignLines lines) {
    write(block, shop, Optional.of(lines));
  }

  private void write(Block block, SignShop shop, Optional<SignLines> lines) {
    if (!(block.getState() instanceof Sign sign)) {
      throw new IllegalStateException("shop " + shop.id() + " has no sign at " + pos(block));
    }
    lines.ifPresent(
        text -> {
          var front = sign.getSide(Side.FRONT);
          for (var index = 0; index < text.lines().size(); index++) {
            front.line(index, Component.text(text.lines().get(index)));
          }
        });
    var data = sign.getPersistentDataContainer();
    data.set(shopIdKey, PersistentDataType.LONG, shop.id());
    shop.item()
        .ifPresentOrElse(
            item -> data.set(itemKey, PersistentDataType.STRING, item.template()),
            () -> data.remove(itemKey));
    sign.update();
  }

  /** The live inventory of a container block, or empty if it is no longer a container. */
  public static Optional<Inventory> inventoryOf(Block block) {
    return block.getState(false) instanceof Container container
        ? Optional.of(container.getInventory())
        : Optional.empty();
  }
}
