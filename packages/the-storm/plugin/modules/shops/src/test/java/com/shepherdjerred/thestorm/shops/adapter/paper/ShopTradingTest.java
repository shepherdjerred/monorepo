package com.shepherdjerred.thestorm.shops.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;

final class ShopTradingTest extends ShopsFixture {

  @Test
  void rightClickBuysLeftClickSells() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 32);
    var sign = shop(alice, chest, "", "16", "B 50:S 40", "coal");
    setBalance(bob, 100);
    setBalance(alice, 100);
    messages(alice);

    var buy = click(bob, sign, Action.RIGHT_CLICK_BLOCK);

    assertThat(buy.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(awaitLine(bob, "You bought"))
        .contains("[Shop]: You bought 16 Coal from Alice's shop for 50 crystals.");
    assertThat(count(bob.getInventory(), Material.COAL)).isEqualTo(16);
    assertThat(count(inventoryOf(chest), Material.COAL)).isEqualTo(16);
    assertThat(balance(bob)).isEqualTo(50);
    assertThat(balance(alice)).isEqualTo(150);
    assertThat(awaitLine(alice, "bought"))
        .contains("[Shop]: Bob bought 16 Coal from your shop for 50 crystals.");

    click(bob, sign, Action.LEFT_CLICK_BLOCK);

    assertThat(awaitLine(bob, "You sold"))
        .contains("[Shop]: You sold 16 Coal to Alice's shop for 40 crystals.");
    assertThat(count(bob.getInventory(), Material.COAL)).isZero();
    assertThat(count(inventoryOf(chest), Material.COAL)).isEqualTo(32);
    assertThat(balance(bob)).isEqualTo(90);
    assertThat(balance(alice)).isEqualTo(110);
  }

  @Test
  void anEmptyShopSellsNothingAndChargesNothing() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 15);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    setBalance(bob, 100);

    click(bob, sign, Action.RIGHT_CLICK_BLOCK);

    assertThat(awaitLine(bob, "Out of stock"))
        .contains("[Shop]: Out of stock: the shop has 15 Coal and a trade needs 16.");
    assertThat(balance(bob)).isEqualTo(100);
    assertThat(count(inventoryOf(chest), Material.COAL)).isEqualTo(15);
  }

  @Test
  void aCustomerWhoCannotPayGetsNothing() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 64);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    setBalance(bob, 49);

    click(bob, sign, Action.RIGHT_CLICK_BLOCK);

    assertThat(awaitLine(bob, "Not enough crystals"))
        .contains("[Shop]: Not enough crystals: that costs 50 crystals and you have 49 crystals.");
    assertThat(count(bob.getInventory(), Material.COAL)).isZero();
    assertThat(count(inventoryOf(chest), Material.COAL)).isEqualTo(64);
  }

  @Test
  void theOwnerSetsAQuestionMarkShopsItemByClickingWithIt() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    var sword = ItemStack.of(Material.DIAMOND_SWORD);
    sword.addUnsafeEnchantment(Enchantment.SHARPNESS, 3);
    give(inventoryOf(chest), Material.DIAMOND_SWORD, 1);
    inventoryOf(chest).addItem(sword.clone());
    var sign = shop(alice, chest, "", "1", "B 200", "?");
    messages(alice);
    alice.getInventory().setItemInMainHand(sword.clone());

    click(alice, sign, Action.RIGHT_CLICK_BLOCK);

    assertThat(messages(alice)).contains("[Shop]: This shop now trades Diamond Sword*.");
    assertThat(((Sign) sign.getState()).getSide(Side.FRONT).line(3))
        .isEqualTo(Component.text("Diamond Sword*"));

    setBalance(bob, 500);
    click(bob, sign, Action.RIGHT_CLICK_BLOCK);
    awaitLine(bob, "You bought");

    var bought = requireNonNull(bob.getInventory().getItem(0));
    assertThat(bought.getEnchantmentLevel(Enchantment.SHARPNESS)).isEqualTo(3);
    // The plain sword is a different item and stays in the chest.
    assertThat(count(inventoryOf(chest), Material.DIAMOND_SWORD)).isEqualTo(1);

    click(bob, sign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(bob, "Out of stock")).isNotEmpty();
  }

  @Test
  void customersCannotBuyFromAShopWithNoItemYet() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var sign = shop(alice, chest(0), "", "1", "B 200", "?");

    click(bob, sign, Action.RIGHT_CLICK_BLOCK);

    assertThat(messages(bob)).containsExactly("[Shop]: This shop is not open yet.");
  }

  @Test
  void theOwnerChecksStockAndMayBreakTheirSign() throws Exception {
    var alice = player("Alice", 1);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 20);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    messages(alice);

    click(alice, sign, Action.RIGHT_CLICK_BLOCK);
    var leftClick = click(alice, sign, Action.LEFT_CLICK_BLOCK);

    assertThat(messages(alice))
        .containsExactly("[Shop]: Your shop holds 20 Coal with room for 1708 more.");
    assertThat(leftClick.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
  }

  @Test
  void adminShopsHaveEndlessStockAndTradeWithTheServer() throws Exception {
    var root = admin("Root");
    var bob = player("Bob", 0);
    var stone = world.getBlockAt(0, 64, 0);
    stone.setType(Material.STONE);
    var sign = shop(root, stone, "Admin Shop", "4", "B 60:S 48", "emerald");
    give(bob.getInventory(), Material.EMERALD, 4);

    click(bob, sign, Action.LEFT_CLICK_BLOCK);

    assertThat(awaitLine(bob, "You sold"))
        .contains("[Shop]: You sold 4 Emerald to the Admin Shop for 48 crystals.");
    assertThat(balance(bob)).isEqualTo(48);
    assertThat(count(bob.getInventory(), Material.EMERALD)).isZero();

    setBalance(bob, 600);
    for (var trade = 0; trade < 5; trade++) {
      click(bob, sign, Action.RIGHT_CLICK_BLOCK);
      awaitLine(bob, "You bought");
    }
    assertThat(count(bob.getInventory(), Material.EMERALD)).isEqualTo(20);
    assertThat(balance(bob)).isEqualTo(300);
  }

  @Test
  void anAdminSetsAPendingAdminShopsItemThenTradesThereLikeAnyone() throws Exception {
    var root = admin("Root");
    var bob = player("Bob", 0);
    var stone = world.getBlockAt(0, 64, 0);
    stone.setType(Material.STONE);
    var sign = shop(root, stone, "Admin Shop", "1", "B 10", "?");
    messages(root);
    root.getInventory().setItemInMainHand(ItemStack.of(Material.NAME_TAG));

    click(root, sign, Action.RIGHT_CLICK_BLOCK);

    assertThat(messages(root)).containsExactly("[Shop]: This shop now trades Name Tag.");
    setBalance(bob, 10);
    click(bob, sign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(bob, "You bought")).isNotEmpty();
    assertThat(count(bob.getInventory(), Material.NAME_TAG)).isEqualTo(1);
    setBalance(root, 10);
    click(root, sign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(root, "You bought")).isNotEmpty();
  }

  @Test
  void anOfflineOwnerGetsASummaryOnJoin() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 64);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    setBalance(bob, 200);
    alice.disconnect();

    click(bob, sign, Action.RIGHT_CLICK_BLOCK);
    awaitLine(bob, "You bought");
    click(bob, sign, Action.RIGHT_CLICK_BLOCK);
    awaitLine(bob, "You bought");
    alice.reconnect();

    assertThat(awaitLine(alice, "Sold"))
        .contains(
            "[Shop]: While you were away, your shops made 2 trades: earned 100 crystals, spent 0"
                + " crystals.",
            "[Shop]: Sold 32 Coal for 100 crystals.");
  }
}
