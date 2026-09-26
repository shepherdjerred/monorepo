package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.shops.domain.trade.Stockpile;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Item;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Item fingerprints and inventory holdings on real (mock) item stacks. */
final class ItemsAndHoldingsTest extends ShopsFixture {

  private final ItemTemplates templates = new ItemTemplates();

  private static ItemStack enchanted(int level) {
    var sword = ItemStack.of(Material.DIAMOND_SWORD);
    sword.addUnsafeEnchantment(Enchantment.SHARPNESS, level);
    return sword;
  }

  private static ItemStack named(Material material, String name) {
    var item = ItemStack.of(material);
    var meta = item.getItemMeta();
    meta.displayName(Component.text(name));
    item.setItemMeta(meta);
    return item;
  }

  @Test
  void aFingerprintIgnoresTheAmountButNotTheComponents() {
    var coal = templates.fingerprint(ItemStack.of(Material.COAL, 40));

    assertThat(coal.material()).isEqualTo("coal");
    assertThat(coal.special()).isFalse();
    assertThat(templates.matches(coal, ItemStack.of(Material.COAL, 1))).isTrue();
    assertThat(templates.matches(coal, ItemStack.of(Material.CHARCOAL))).isFalse();
    assertThat(templates.matches(coal, named(Material.COAL, "Lucky coal"))).isFalse();
    assertThat(templates.matches(coal, ItemStack.of(Material.AIR))).isFalse();
    assertThat(templates.fingerprint(ItemStack.of(Material.COAL, 3))).isEqualTo(coal);
  }

  @Test
  void enchantedItemsMatchOnlyTheSameEnchantments() {
    var sharp3 = templates.fingerprint(enchanted(3));

    assertThat(sharp3.special()).isTrue();
    assertThat(templates.matches(sharp3, enchanted(3))).isTrue();
    assertThat(templates.matches(sharp3, enchanted(4))).isFalse();
    assertThat(templates.matches(sharp3, ItemStack.of(Material.DIAMOND_SWORD))).isFalse();
  }

  @Test
  void renamedItemsAreNotTheSameAsPlainOnesWhateverTheirText() {
    var fancy = templates.fingerprint(named(Material.DIAMOND, "Coal"));

    assertThat(fancy.material()).isEqualTo("diamond");
    assertThat(fancy.special()).isTrue();
    assertThat(templates.matches(fancy, named(Material.DIAMOND, "Coal"))).isTrue();
    assertThat(templates.matches(fancy, ItemStack.of(Material.DIAMOND))).isFalse();
    assertThat(templates.matches(fancy, named(Material.COAL, "Coal"))).isFalse();
  }

  @Test
  void aStoredFingerprintDecodesInAFreshProcess() {
    var stored = new ItemTemplates().fingerprint(enchanted(2));

    var decoded = new ItemTemplates().template(stored);

    assertThat(decoded.getAmount()).isEqualTo(1);
    assertThat(decoded.isSimilar(enchanted(2))).isTrue();
  }

  @Test
  void containersWithItemsInsideAreSpotted() {
    var bundle = ItemStack.of(Material.BUNDLE);
    assertThat(ItemTemplates.holdsItems(bundle)).isFalse();
    var bundleMeta = (org.bukkit.inventory.meta.BundleMeta) bundle.getItemMeta();
    bundleMeta.addItem(ItemStack.of(Material.COAL));
    bundle.setItemMeta(bundleMeta);
    assertThat(ItemTemplates.holdsItems(bundle)).isTrue();

    var box = ItemStack.of(Material.SHULKER_BOX);
    assertThat(ItemTemplates.holdsItems(box)).isFalse();
    var boxMeta = (org.bukkit.inventory.meta.BlockStateMeta) box.getItemMeta();
    var state = (org.bukkit.block.ShulkerBox) boxMeta.getBlockState();
    state.getInventory().addItem(ItemStack.of(Material.DIAMOND, 3));
    boxMeta.setBlockState(state);
    box.setItemMeta(boxMeta);
    assertThat(ItemTemplates.holdsItems(box)).isTrue();
    assertThat(ItemTemplates.holdsItems(ItemStack.of(Material.COAL))).isFalse();
  }

  @Test
  void airHasNoFingerprint() {
    assertThatThrownBy(() -> templates.fingerprint(ItemStack.of(Material.AIR)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void itemNamesResolveLikeSignText() {
    assertThat(ItemTemplates.item("coal")).contains(Material.COAL);
    assertThat(ItemTemplates.item("minecraft:oak_log")).contains(Material.OAK_LOG);
    assertThat(ItemTemplates.item("Diamond Sword")).contains(Material.DIAMOND_SWORD);
    assertThat(ItemTemplates.item("unobtainium")).isEmpty();
    assertThat(ItemTemplates.item("air")).isEmpty();
    assertThat(ItemTemplates.item("water")).isEmpty();
  }

  @Test
  void playerHoldingsUseOnlyTheMainInventory() {
    var bob = player("Bob", 0);
    var inventory = bob.getInventory();
    inventory.setItem(0, ItemStack.of(Material.ENDER_PEARL, 10));
    inventory.setItem(5, ItemStack.of(Material.STONE, 64));
    inventory.setItem(20, ItemStack.of(Material.ENDER_PEARL, 16));
    inventory.setItemInOffHand(ItemStack.of(Material.ENDER_PEARL, 16));
    var pearls = holdings(bob, ItemStack.of(Material.ENDER_PEARL));

    // 34 slots are free of other things; pearls stack to 16.
    assertThat(pearls.stockpile()).isEqualTo(new Stockpile(26, 6 + 33 * 16));

    pearls.remove(12);
    assertThat(inventory.getItem(0)).isNull();
    assertThat(inventory.getItem(20)).isEqualTo(ItemStack.of(Material.ENDER_PEARL, 14));
    assertThat(inventory.getItemInOffHand().getAmount()).isEqualTo(16);

    pearls.add(20);
    assertThat(inventory.getItem(20)).isEqualTo(ItemStack.of(Material.ENDER_PEARL, 16));
    assertThat(inventory.getItem(0)).isEqualTo(ItemStack.of(Material.ENDER_PEARL, 16));
    assertThat(inventory.getItem(1)).isEqualTo(ItemStack.of(Material.ENDER_PEARL, 2));
    assertThat(inventory.getItem(5)).isEqualTo(ItemStack.of(Material.STONE, 64));
  }

  private InventoryHoldings holdings(PlayerMock player, ItemStack template) {
    return InventoryHoldings.ofPlayer(
        server, player.getUniqueId(), template, ShopBlocks.locationOf(player));
  }

  @Test
  void aPlayerWhoLeftHasNoStockOrRoomAndReturnsDropWhereTheyTraded() {
    var bob = player("Bob", 0);
    bob.getInventory().setItem(0, ItemStack.of(Material.ENDER_PEARL, 10));
    var tradingAt = ShopBlocks.locationOf(bob).clone();
    var pearls = holdings(bob, ItemStack.of(Material.ENDER_PEARL));

    bob.disconnect();

    assertThat(pearls.stockpile()).isEqualTo(new Stockpile(0, 0));
    pearls.addOrDrop(5);
    assertThat(bob.getInventory().getItem(0)).isEqualTo(ItemStack.of(Material.ENDER_PEARL, 10));
    assertThat(
            tradingAt.getWorld().getEntitiesByClass(Item.class).stream()
                .mapToInt(item -> item.getItemStack().getAmount())
                .sum())
        .isEqualTo(5);
  }

  @Test
  void holdingsRefuseToOverdraw() {
    var bob = player("Bob", 0);
    var pearls = holdings(bob, ItemStack.of(Material.ENDER_PEARL));

    assertThatThrownBy(() -> pearls.remove(1)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void returnedItemsThatDoNotFitDropAtTheHoldersFeet() {
    var bob = player("Bob", 0);
    for (var slot = 0; slot < 36; slot++) {
      bob.getInventory().setItem(slot, ItemStack.of(Material.STONE, 64));
    }
    bob.getInventory().setItem(3, ItemStack.of(Material.ENDER_PEARL, 10));
    var pearls = holdings(bob, ItemStack.of(Material.ENDER_PEARL));

    pearls.addOrDrop(30);

    assertThat(bob.getInventory().getItem(3)).isEqualTo(ItemStack.of(Material.ENDER_PEARL, 16));
    var dropped =
        bob.getWorld().getEntitiesByClass(Item.class).stream()
            .mapToInt(item -> item.getItemStack().getAmount())
            .sum();
    assertThat(dropped).isEqualTo(24);
  }

  @Test
  void aContainerThatIsGoneHasNoStockAndNoRoom() {
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 5);
    var holdings =
        InventoryHoldings.of(
            () -> ShopBlocks.inventoryOf(chest),
            ItemStack.of(Material.COAL),
            () -> Optional.of(chest.getLocation()));
    assertThat(holdings.stockpile().count()).isEqualTo(5);

    chest.setType(Material.STONE);

    assertThat(holdings.stockpile()).isEqualTo(new Stockpile(0, 0));
    assertThatThrownBy(() -> holdings.add(1)).isInstanceOf(IllegalStateException.class);
  }
}
