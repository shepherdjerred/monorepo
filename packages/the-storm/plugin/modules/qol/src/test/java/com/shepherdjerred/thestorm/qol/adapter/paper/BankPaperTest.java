package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class BankPaperTest {

  @TempDir Path directory;
  QolHarness harness;

  @BeforeEach
  void start() {
    harness = QolHarness.start(directory);
  }

  @AfterEach
  void stop() {
    harness.close();
  }

  @Test
  void aBankShelvesWhatItsShelfAccepts() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bank = chest(0);
    var bankSign = signOn(bank);
    assertThat(write(alice, bankSign, "[Bank]", "", "", "").isCancelled()).isFalse();
    assertThat(harness.awaitMessage(alice, "Bank created.")).isNotEmpty();
    assertThat(requireNonNull(harness.paper, "qol").banks().all()).hasSize(1);

    var shelf = chest(3);
    var shelfSign = signOn(shelf);
    assertThat(write(alice, shelfSign, "[Shelf]", "stone", "", "").isCancelled()).isFalse();
    assertThat(harness.awaitMessage(alice, "Shelf linked.")).isNotEmpty();

    var bankInventory = ((Container) bank.getState()).getInventory();
    bankInventory.addItem(new ItemStack(Material.STONE, 10));
    alice.openInventory(bankInventory);
    alice.closeInventory();

    assertThat(count(bank, Material.STONE)).isZero();
    assertThat(count(shelf, Material.STONE)).isEqualTo(10);
  }

  @Test
  void aBlankShelfSamplesItsCurrentContentsLikeMondoChest() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bank = chest(0);
    write(alice, signOn(bank), "[Bank]", "", "", "");
    var shelf = chest(3);
    write(alice, signOn(shelf), "[Shelf]", "", "", "");
    var stock = ((Container) shelf.getState()).getInventory();
    stock.addItem(ItemStack.of(Material.STONE, 1));
    var incoming = ((Container) bank.getState()).getInventory();
    incoming.addItem(ItemStack.of(Material.STONE, 10), ItemStack.of(Material.DIRT, 12));
    alice.openInventory(incoming);
    alice.closeInventory();
    assertThat(count(bank, Material.STONE)).isZero();
    assertThat(count(shelf, Material.STONE)).isEqualTo(11);
    assertThat(count(bank, Material.DIRT)).isEqualTo(12);

    stock.clear();
    stock.addItem(ItemStack.of(Material.DIRT, 1));
    alice.openInventory(incoming);
    alice.closeInventory();
    assertThat(count(bank, Material.DIRT)).isZero();
    assertThat(count(shelf, Material.DIRT)).isEqualTo(13);
  }

  @Test
  void aShopContainerCannotBecomeABank() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bank = chest(0);
    harness.reserved.add("0,64,0");
    var event = write(alice, signOn(bank), "[Bank]", "", "", "");
    assertThat(event.isCancelled()).isTrue();
    assertThat(harness.awaitMessage(alice, "already a shop")).isNotEmpty();
    assertThat(requireNonNull(harness.paper, "qol").banks().all()).isEmpty();
  }

  @Test
  void someoneElsesLockRefusesTheBank() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bank = chest(0);
    harness.land.noContainers = location -> location.getBlockX() == 0 && location.getBlockY() == 64;
    var event = write(alice, signOn(bank), "[Bank]", "", "", "");
    assertThat(event.isCancelled()).isTrue();
    assertThat(harness.awaitMessage(alice, "This land belongs to Aegis.")).isNotEmpty();
    assertThat(requireNonNull(harness.paper, "qol").banks().all()).isEmpty();
  }

  @Test
  void bankAndShelfLinksSurviveDeletingTheirDatabaseIndex() throws Exception {
    var alice = harness.playerAt("Alice", 0, 0);
    var bank = chest(0);
    write(alice, signOn(bank), "[Bank]", "", "", "");
    var shelf = chest(3);
    write(alice, signOn(shelf), "[Shelf]", "stone", "", "");
    var book = requireNonNull(harness.paper, "qol").banks();
    var id = book.all().getFirst().id();
    var store = new com.shepherdjerred.thestorm.qol.adapter.db.JooqBankStore(harness.database);
    store.delete(id).get(5, TimeUnit.SECONDS);
    book.load(List.of());

    var inventory = ((Container) bank.getState()).getInventory();
    inventory.addItem(ItemStack.of(Material.STONE, 10));
    alice.openInventory(inventory);
    alice.closeInventory();

    assertThat(count(bank, Material.STONE)).isZero();
    assertThat(count(shelf, Material.STONE)).isEqualTo(10);
    assertThat(book.all())
        .singleElement()
        .satisfies(restored -> assertThat(restored.owner()).isEqualTo(alice.getUniqueId()));
  }

  @Test
  void currentShelfTextOverridesTheOldStoredFilter() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bank = chest(0);
    write(alice, signOn(bank), "[Bank]", "", "", "");
    var shelf = chest(3);
    var signBlock = signOn(shelf);
    write(alice, signBlock, "[Shelf]", "stone", "", "");
    var sign = (org.bukkit.block.Sign) signBlock.getState();
    sign.getSide(Side.FRONT).line(1, Component.text("dirt"));
    sign.update();
    var inventory = ((Container) bank.getState()).getInventory();
    inventory.addItem(ItemStack.of(Material.STONE, 10), ItemStack.of(Material.DIRT, 12));

    alice.openInventory(inventory);
    alice.closeInventory();

    assertThat(count(bank, Material.STONE)).isEqualTo(10);
    assertThat(count(shelf, Material.STONE)).isZero();
    assertThat(count(shelf, Material.DIRT)).isEqualTo(12);
  }

  @Test
  void aLaterCancellationCannotPersistABank() throws Exception {
    var alice = harness.playerAt("Alice", 0, 0);
    var plugin = requireNonNull(harness.server.getPluginManager().getPlugin("TheStorm"));
    harness
        .server
        .getPluginManager()
        .registerEvent(
            SignChangeEvent.class,
            new org.bukkit.event.Listener() {},
            org.bukkit.event.EventPriority.HIGHEST,
            (listener, event) -> ((SignChangeEvent) event).setCancelled(true),
            plugin);
    var bank = chest(0);

    assertThat(write(alice, signOn(bank), "[Bank]", "", "", "").isCancelled()).isTrue();

    assertThat(requireNonNull(harness.paper, "qol").banks().all()).isEmpty();
    assertThat(new WorldBanks(harness.server).read(bank)).isEmpty();
    assertThat(
            new com.shepherdjerred.thestorm.qol.adapter.db.JooqBankStore(harness.database)
                .loadAll()
                .get(5, TimeUnit.SECONDS))
        .isEmpty();
  }

  private Block chest(int x) {
    harness.world.loadChunk(0, 0);
    var block = harness.world.getBlockAt(x, 64, 0);
    block.setType(Material.CHEST);
    return block;
  }

  private Block signOn(Block support) {
    var sign = support.getRelative(BlockFace.SOUTH);
    sign.setType(Material.OAK_WALL_SIGN);
    var data = (WallSign) sign.getBlockData();
    data.setFacing(BlockFace.SOUTH);
    sign.setBlockData(data);
    return sign;
  }

  private SignChangeEvent write(Player player, Block sign, String... lines) {
    var components = new ArrayList<Component>();
    for (var line : lines) {
      components.add(Component.text(line));
    }
    var event = new SignChangeEvent(sign, player, components, Side.FRONT);
    harness.server.getPluginManager().callEvent(event);
    if (!event.isCancelled()) {
      var state = (org.bukkit.block.Sign) sign.getState();
      for (var index = 0; index < 4; index++)
        state.getSide(Side.FRONT).line(index, event.lines().get(index));
      state.update();
    }
    return event;
  }

  private static int count(Block block, Material material) {
    var contents = ((Container) block.getState()).getInventory().getContents();
    if (contents == null) {
      return 0;
    }
    var total = 0;
    for (var stack : contents) {
      if (stack != null && stack.getType() == material) {
        total += stack.getAmount();
      }
    }
    return total;
  }
}
