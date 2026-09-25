package com.shepherdjerred.thestorm.shops.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The shops on MockBukkit with a real SQLite database and a fake ledger. Replies arrive after a
 * main-thread hop, so tests tick the scheduler until the expected line shows up.
 */
abstract class ShopsFixture {

  @TempDir Path directory;

  ServerMock server;
  ShopsTestPlugin plugin;
  WorldMock world;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    ShopsTestPlugin.directory = directory;
    plugin =
        MockBukkit.loadWith(
            ShopsTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", ShopsTestPlugin.class.getName()));
    world = server.addSimpleWorld("world");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  PlayerMock player(String name, int shopkeeperLevel) {
    var player = server.addPlayer(name);
    for (var level = 1; level <= shopkeeperLevel; level++) {
      player.addAttachment(plugin, Track.SHOPKEEPER.permission(level), true);
    }
    return player;
  }

  PlayerMock admin(String name) {
    var player = server.addPlayer(name);
    player.addAttachment(plugin, ShopsPaper.ADMIN_PERMISSION, true);
    return player;
  }

  Block container(int x, Material type) {
    var block = world.getBlockAt(x, 64, 0);
    block.setType(type);
    return block;
  }

  Block chest(int x) {
    return container(x, Material.CHEST);
  }

  /** A wall sign on the south face of {@code support}. */
  Block signOn(Block support) {
    var sign = support.getRelative(BlockFace.SOUTH);
    sign.setType(Material.OAK_WALL_SIGN);
    var data = (WallSign) sign.getBlockData();
    data.setFacing(BlockFace.SOUTH);
    sign.setBlockData(data);
    return sign;
  }

  SignChangeEvent write(Player player, Block sign, String... lines) {
    var components = new ArrayList<Component>();
    for (var line : lines) {
      components.add(Component.text(line));
    }
    var event = new SignChangeEvent(sign, player, components, Side.FRONT);
    server.getPluginManager().callEvent(event);
    return event;
  }

  static List<String> lines(SignChangeEvent event) {
    return event.lines().stream().map(ShopsFixture::plain).toList();
  }

  /** Writes a shop sign and lets the id stamp land. */
  Block shop(Player owner, Block container, String... lines) {
    var sign = signOn(container);
    var event = write(owner, sign, lines);
    if (event.isCancelled()) {
      fail("the shop sign was refused");
    }
    tick(2);
    return sign;
  }

  PlayerInteractEvent click(Player player, Block block, Action action) {
    var event =
        new PlayerInteractEvent(
            player,
            action,
            player.getInventory().getItemInMainHand(),
            block,
            BlockFace.SOUTH,
            EquipmentSlot.HAND);
    server.getPluginManager().callEvent(event);
    return event;
  }

  static Inventory inventoryOf(Block container) {
    return ((Container) container.getState()).getInventory();
  }

  static int count(Inventory inventory, Material material) {
    var total = 0;
    for (var item : requireNonNull(inventory.getContents())) {
      if (item != null && item.getType() == material) {
        total += item.getAmount();
      }
    }
    return total;
  }

  static void give(Inventory inventory, Material material, int amount) {
    var left = inventory.addItem(ItemStack.of(material, amount));
    if (!left.isEmpty()) {
      fail("could not fit %s %s", amount, material);
    }
  }

  long balance(Player player) {
    return plugin.wallets.balanceOf(new AccountId.Player(player.getUniqueId()));
  }

  void setBalance(Player player, long crystals) {
    plugin.wallets.set(new AccountId.Player(player.getUniqueId()), crystals);
  }

  /** The stored shops, once every write queued so far has landed. */
  List<SignShop> storedShops() throws Exception {
    plugin.database().write(dsl -> 0).get(10, TimeUnit.SECONDS);
    return new JooqShopStore(plugin.database()).loadShops().get(10, TimeUnit.SECONDS);
  }

  void tick(int ticks) {
    for (var index = 0; index < ticks; index++) {
      server.getScheduler().performOneTick();
    }
  }

  /** Everything {@code player} has been sent so far. */
  static List<String> messages(PlayerMock player) {
    var seen = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      seen.add(plain(message));
    }
    return seen;
  }

  /** Ticks until {@code player} receives a line containing {@code text}; returns what they saw. */
  List<String> awaitLine(PlayerMock player, String text) throws InterruptedException {
    var seen = new ArrayList<String>();
    for (var attempt = 0; attempt < 400; attempt++) {
      server.getScheduler().performOneTick();
      seen.addAll(messages(player));
      if (seen.stream().anyMatch(line -> line.contains(text))) {
        return seen;
      }
      Thread.sleep(5);
    }
    return fail("%s never saw \"%s\"; saw %s", player.getName(), text, seen);
  }
}
