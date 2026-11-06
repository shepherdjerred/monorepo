package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.adapter.paper.ItemTemplates;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.block.Chest;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** A full chest and an audited historical listing, only for the opt-in Paper retry test. */
final class HistoricalShopFixtures {
  private HistoricalShopFixtures() {}

  static void prepare(World world, Path content, String mode) {
    if (mode.equals("dockozel")) return;
    if (mode.equals("double-split")) {
      var savedSign = world.getBlockAt(158, 68, -126).getState();
      var shopKey = Objects.requireNonNull(NamespacedKey.fromString("thestorm:shop_id"));
      if (!(savedSign instanceof Sign sign)
          || !sign.getPersistentDataContainer().has(shopKey, PersistentDataType.LONG))
        prepareSplitChest(world);
      return;
    }
    if (!mode.equals("1")
        && !mode.equals("recovery")
        && !mode.equals("missing")
        && !mode.equals("double")
        && !mode.equals("double-space")
        && !mode.equals("placed"))
      throw new IllegalArgumentException("unknown historical shop fixture mode");
    var missing = mode.equals("missing") || mode.equals("placed");
    if (mode.equals("double") || mode.equals("double-space"))
      prepareDoubleChest(world, mode.equals("double-space"));
    else prepareChest(world, missing);
    prepareSign(world, missing, mode.equals("recovery"));
    if (mode.equals("recovery")) seedCompletedReceipt(world, content);
  }

  private static void prepareSplitChest(World world) {
    var first = world.getBlockAt(158, 67, -128);
    var second = world.getBlockAt(159, 67, -128);
    first.setType(Material.CHEST, false);
    second.setType(Material.CHEST, false);
    first.setBlockData(
        org.bukkit.Bukkit.createBlockData("minecraft:chest[facing=north,type=left]"), false);
    second.setBlockData(
        org.bukkit.Bukkit.createBlockData("minecraft:chest[facing=north,type=right]"), false);
    for (var block : List.of(first, second)) {
      var chest = (Chest) block.getState();
      for (var slot = 0; slot < 23; slot++)
        chest.getSnapshotInventory().setItem(slot, ItemStack.of(Material.COBBLESTONE, 64));
      if (!chest.update(true, false))
        throw new IllegalStateException("Could not prepare split chest");
    }
    if (((Chest) first.getState()).getInventory().getSize() != 54)
      throw new IllegalStateException("Fixture chest halves did not join");
    var signBlock = world.getBlockAt(158, 68, -126);
    signBlock.setType(Material.OAK_SIGN);
    var sign = (Sign) signBlock.getState();
    var lines = new String[] {"[Buy]", "64", "Arrows", "20"};
    for (var i = 0; i < lines.length; i++)
      sign.getSide(Side.FRONT).line(i, Component.text(lines[i]));
    if (!sign.update(true, false)) throw new IllegalStateException("Could not prepare split sign");
  }

  private static void prepareDoubleChest(World world, boolean firstFull) {
    var first = world.getBlockAt(138, 68, -97);
    var second = world.getBlockAt(139, 68, -97);
    first.setType(Material.CHEST, false);
    second.setType(Material.CHEST, false);
    first.setBlockData(
        org.bukkit.Bukkit.createBlockData("minecraft:chest[facing=north,type=left]"), false);
    second.setBlockData(
        org.bukkit.Bukkit.createBlockData("minecraft:chest[facing=north,type=right]"), false);
    var neighbor = (Chest) second.getState();
    if (firstFull) {
      var anchor = (Chest) first.getState();
      for (var slot = 0; slot < anchor.getSnapshotInventory().getSize(); slot++)
        anchor.getSnapshotInventory().setItem(slot, ItemStack.of(Material.COBBLESTONE, 64));
      if (!anchor.update(true, false)) throw new IllegalStateException("Could not fill anchor");
    } else {
      neighbor.getSnapshotInventory().setItem(0, ItemStack.of(Material.IRON_INGOT, 40));
    }
    if (!neighbor.update(true, false)) throw new IllegalStateException("Could not prepare chest");
    if (((Chest) first.getState()).getInventory().getSize() != 54)
      throw new IllegalStateException("Fixture chest halves did not join");
  }

  private static void prepareChest(World world, boolean missing) {
    var chestBlock = world.getBlockAt(138, 68, -97);
    if (missing) {
      chestBlock.setType(Material.AIR);
      world.getBlockAt(138, 67, -97).setType(Material.STONE);
    } else {
      chestBlock.setType(Material.CHEST);
      var chest = (Chest) chestBlock.getState();
      for (var slot = 0; slot < chest.getSnapshotInventory().getSize(); slot++) {
        chest.getSnapshotInventory().setItem(slot, ItemStack.of(Material.COBBLESTONE, 64));
      }
      if (!chest.update(true, false)) throw new IllegalStateException("Could not prepare chest");
    }
  }

  private static void prepareSign(World world, boolean missing, boolean recovery) {
    var signBlock = world.getBlockAt(138, 69, -97);
    if (missing) {
      world.getBlockAt(139, 69, -97).setType(Material.STONE);
      signBlock.setType(Material.OAK_WALL_SIGN);
      var wall = (org.bukkit.block.data.type.WallSign) signBlock.getBlockData();
      wall.setFacing(org.bukkit.block.BlockFace.WEST);
      signBlock.setBlockData(wall);
    } else {
      signBlock.setType(Material.OAK_SIGN);
    }
    var sign = (Sign) signBlock.getState();
    var lines = new String[] {"[Buy]", "6", "Iron Ingot", "18"};
    for (var i = 0; i < lines.length; i++) {
      sign.getSide(Side.FRONT).line(i, Component.text(lines[i]));
    }
    if (recovery) {
      sign.getPersistentDataContainer()
          .set(
              Objects.requireNonNull(NamespacedKey.fromString("thestorm:shop_id")),
              PersistentDataType.LONG,
              1L);
    }
    if (!sign.update(true, false)) throw new IllegalStateException("Could not prepare sign");
  }

  private static void seedCompletedReceipt(World world, Path content) {
    var shop =
        new SignShop(
            1,
            new BlockPos(world.getUID(), 138, 69, -97),
            Optional.of(new BlockPos(world.getUID(), 138, 68, -97)),
            new ShopOwner.Player(
                UUID.fromString("c538a540-3e91-4680-9e98-43f4d811e8e2"), "Pigrider102"),
            6,
            ShopPrices.buyOnly(18),
            Optional.of(new ItemTemplates().plain(Material.IRON_INGOT)),
            Instant.parse("2026-10-28T00:00:00Z"));
    try (var database = StormDatabase.open(content.resolve("the-storm.db"))) {
      database.migrate("shops", JooqShopStore.class.getClassLoader());
      var store = new JooqShopStore(database);
      if (store.importHistorical("2015-pigrider-iron", shop).get(30, TimeUnit.SECONDS)
              != JooqShopStore.HistoricalImport.IMPORTED
          || store.completeHistorical("2015-pigrider-iron", 1).get(30, TimeUnit.SECONDS) != 1) {
        throw new IllegalStateException("Could not seed completed receipt");
      }
    } catch (Exception error) {
      throw new IllegalStateException("Could not seed historical shop recovery", error);
    }
  }
}
