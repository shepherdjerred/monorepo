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
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
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
  private final WorldShopData worldData;
  private Consumer<Block> discover = ignored -> {};
  private Consumer<SignShop> index = ignored -> {};

  public ShopBlocks(Plugin plugin, ShopRegistry registry, Set<Material> containers) {
    this(
        plugin,
        registry,
        containers,
        com.shepherdjerred.thestorm.core.reset.AccountEpochs.inMemory());
  }

  public ShopBlocks(
      Plugin plugin,
      ShopRegistry registry,
      Set<Material> containers,
      com.shepherdjerred.thestorm.core.reset.AccountEpochs epochs) {
    this.server = plugin.getServer();
    this.registry = registry;
    this.containers = Set.copyOf(containers);
    this.shopIdKey = new NamespacedKey(plugin, "shop_id");
    this.itemKey = new NamespacedKey(plugin, "shop_item");
    this.worldData = new WorldShopData(plugin, epochs);
  }

  boolean legacyOwner(com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner owner) {
    return worldData.legacyOwner(owner);
  }

  void discovery(Consumer<Block> discover, Consumer<SignShop> index) {
    this.discover = discover;
    this.index = index;
  }

  long lastWorldId() {
    return server.getWorlds().stream().mapToLong(worldData::lastId).max().orElse(0);
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
    if (!loaded(sign)) return Optional.empty();
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
    return loaded(block)
        && containers.contains(block.getType())
        && block.getState(false) instanceof Container;
  }

  private static boolean loaded(Block block) {
    return block.getWorld().isChunkLoaded(block.getX() >> 4, block.getZ() >> 4);
  }

  /** ChestShop also accepts a chest immediately below or beside the sign. */
  public Optional<Block> connectedContainer(Block sign) {
    if (!loaded(sign)) return Optional.empty();
    var support = supportOf(sign).filter(this::isShopContainer);
    if (support.isPresent()) return support;
    for (var face :
        List.of(BlockFace.DOWN, BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST)) {
      var neighbor = sign.getRelative(face);
      if (isShopContainer(neighbor)) return Optional.of(neighbor);
    }
    return Optional.empty();
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
    for (var position : containerBlocks(block)) {
      block(position)
          .ifPresent(container -> {
            for (var face :
                List.of(
                    BlockFace.UP,
                    BlockFace.NORTH,
                    BlockFace.EAST,
                    BlockFace.SOUTH,
                    BlockFace.WEST)) {
              shopAtSign(container.getRelative(face));
            }
          });
    }
    return containerBlocks(block).stream()
        .flatMap(pos -> registry.tradingFrom(pos).stream())
        .filter(shop -> block(shop.sign()).flatMap(this::shopAtSign).isPresent())
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
    var broken = pos(block);
    registry.atSign(broken).ifPresent(shops::add);
    shops.addAll(shopsOnContainer(block));
    // A sign drops when its ordinary support block breaks, without a separate
    // BlockBreakEvent for the sign. Include registered signs physically attached here.
    for (var face :
        List.of(BlockFace.UP, BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST)) {
      var neighbor = block.getRelative(face);
      registry
          .atSign(pos(neighbor))
          .filter(
              shop -> supportOf(neighbor).map(ShopBlocks::pos).filter(broken::equals).isPresent())
          .ifPresent(shops::add);
    }
    return shops.stream().distinct().toList();
  }

  /** Reconstructs the current shop from its world identity, visible text and connected chest. */
  public Optional<SignShop> shopAtSign(Block block) {
    if (!loaded(block)) return Optional.empty();
    if (!(block.getState(false) instanceof Sign sign)) {
      registry.atSign(pos(block)).ifPresent(shop -> registry.evict(shop.id()));
      return Optional.empty();
    }
    var lines = lines(sign);
    var previous = registry.atSign(pos(block));
    upgradeIdentity(sign, previous, lines);
    if (worldData.revoked(sign)) {
      previous.ifPresent(shop -> registry.evict(shop.id()));
      return Optional.empty();
    }
    var found =
        worldData
            .read(sign, lines, connectedContainer(block).map(ShopBlocks::pos))
            .filter(shop ->
                shop.container().isEmpty()
                    || shop.container()
                        .flatMap(this::block)
                        .filter(this::isShopContainer)
                        .isPresent());
    if (found.isEmpty()) {
      previous.ifPresent(shop -> registry.evict(shop.id()));
      if (registry.isReady() && !worldData.identified(sign)) discover.accept(block);
      return registry.atSign(pos(block));
    }
    var current = found.orElseThrow();
    var collision = registry.byId(current.id());
    if (collision.isPresent() && !collision.orElseThrow().sign().equals(current.sign())) {
      current =
          new SignShop(
              registry.reserveId(),
              current.sign(),
              current.container(),
              current.owner(),
              current.quantity(),
              current.prices(),
              current.item(),
              current.createdAt());
      stamp(block, current);
    }
    if (!previous.equals(Optional.of(current))) {
      var closure = registry.closure(current.id());
      previous.ifPresent(shop -> registry.evict(shop.id()));
      registry.evict(current.id());
      registry.add(current);
      var installed = current;
      closure.ifPresent(reason -> registry.close(installed.id(), reason));
      index.accept(current);
    }
    return Optional.of(current);
  }

  private void upgradeIdentity(Sign sign, Optional<SignShop> previous, SignLines lines) {
    var savedId = sign.getPersistentDataContainer().get(shopIdKey, PersistentDataType.LONG);
    var identity = new NamespacedKey(shopIdKey.getNamespace(), "shop_owner_kind");
    // Upgrade a stamped legacy sign only before its owner's first account reset.
    if (previous.isEmpty() || savedId == null || sign.getPersistentDataContainer().has(identity))
      return;
    var shop = previous.orElseThrow();
    if (!legacyOwner(shop.owner())
        || shop.id() != savedId
        || !lines.owner().equals(shop.lines("Admin Shop").owner())) return;
    worldData.write(sign, shop, lines.owner());
    if (!sign.update(false, false))
      throw new IllegalStateException("shop sign changed during identity upgrade");
  }

  static SignLines lines(Sign sign) {
    return new SignLines(
        sign.getSide(Side.FRONT).lines().stream()
            .map(PlainTextComponentSerializer.plainText()::serialize)
            .toList());
  }

  /** Recognizes saved shops and legacy buy/sell signs before the registry is ready. */
  boolean isPendingShopSign(Block block) {
    if (!(block.getState(false) instanceof Sign sign)) return false;
    if (sign.getPersistentDataContainer().has(shopIdKey, PersistentDataType.LONG)) return true;
    var first =
        PlainTextComponentSerializer.plainText().serialize(sign.getSide(Side.FRONT).line(0));
    return first.equalsIgnoreCase("[buy]")
        || first.equalsIgnoreCase("[sell]")
        || new com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser(
                999_999_999, "Admin Shop")
            .looksLikeShop(lines(sign));
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
    return write(block, shop, Optional.empty());
  }

  /** Rewrites a shop sign's lines and stamps it. */
  public void rewrite(Block block, SignShop shop, SignLines lines) {
    if (!write(block, shop, Optional.of(lines))) {
      throw new IllegalStateException("could not update shop sign " + shop.id());
    }
  }

  private boolean write(Block block, SignShop shop, Optional<SignLines> lines) {
    if (!(block.getState() instanceof Sign sign)) {
      throw new IllegalStateException("shop " + shop.id() + " has no sign at " + pos(block));
    }
    lines.ifPresent(text -> {
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
    worldData.write(sign, shop, lines(sign).owner());
    return sign.update();
  }

  /** The live inventory of a container block, or empty if it is no longer a container. */
  public static Optional<Inventory> inventoryOf(Block block) {
    return block.getState(false) instanceof Container container
        ? Optional.of(container.getInventory())
        : Optional.empty();
  }
}
