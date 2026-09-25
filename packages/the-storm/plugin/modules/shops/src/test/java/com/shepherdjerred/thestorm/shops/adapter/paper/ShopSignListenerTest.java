package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Sign;
import org.bukkit.persistence.PersistentDataType;
import org.junit.jupiter.api.Test;

final class ShopSignListenerTest extends ShopsFixture {

  @Test
  void aShopkeeperMakesAChestShop() throws Exception {
    var alice = player("Alice", 1);
    var sign = signOn(chest(0));

    var event = write(alice, sign, "whatever", "16", "b50 : s40", "coal");
    tick(2);

    assertThat(event.isCancelled()).isFalse();
    assertThat(lines(event)).containsExactly("Alice", "16", "B 50:S 40", "Coal");
    assertThat(messages(alice)).anySatisfy(line -> assertThat(line).contains("Shop open."));
    var stored = storedShops();
    assertThat(stored)
        .singleElement()
        .satisfies(
            shop -> {
              assertThat(shop.owner())
                  .isEqualTo(new ShopOwner.Player(alice.getUniqueId(), "Alice"));
              assertThat(shop.quantity()).isEqualTo(16);
              assertThat(shop.item())
                  .hasValueSatisfying(item -> assertThat(item.material()).isEqualTo("coal"));
            });
    var stamped =
        ((Sign) sign.getState())
            .getPersistentDataContainer()
            .get(new NamespacedKey(plugin, "shop_id"), PersistentDataType.LONG);
    assertThat(stamped).isEqualTo(stored.getFirst().id());
  }

  @Test
  void copperChestsAndBarrelsAreShopContainers() throws Exception {
    var alice = player("Alice", 2);

    assertThat(
            write(alice, signOn(container(0, Material.BARREL)), "", "1", "B 5", "coal")
                .isCancelled())
        .isFalse();
    assertThat(
            write(alice, signOn(container(5, Material.COPPER_CHEST)), "", "1", "B 5", "coal")
                .isCancelled())
        .isFalse();
    tick(2);
    assertThat(storedShops()).hasSize(2);
  }

  @Test
  void untrainedPlayersCannotMakeChestShops() throws Exception {
    var bob = player("Bob", 0);

    var event = write(bob, signOn(chest(0)), "", "16", "B 50", "coal");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages(bob))
        .containsExactly("[Shop]: You need Shopkeeper I to open a chest shop.");
    tick(2);
    assertThat(storedShops()).isEmpty();
  }

  @Test
  void theSignMustHangOnAShopContainer() {
    var alice = player("Alice", 1);
    var stone = world.getBlockAt(0, 64, 0);
    stone.setType(Material.STONE);

    var event = write(alice, signOn(stone), "", "16", "B 50", "coal");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages(alice))
        .containsExactly("[Shop]: Put the shop sign on a chest, barrel or copper chest.");
  }

  @Test
  void landProtectionIsCheckedAtTheSignAndTheContainer() {
    var alice = player("Alice", 1);
    plugin.protection.denied.add(ProtectedAction.OPEN_CONTAINER);

    var event = write(alice, signOn(chest(0)), "", "16", "B 50", "coal");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages(alice)).containsExactly("[Shop]: This land belongs to Aegis.");

    plugin.protection.denied.clear();
    plugin.protection.denied.add(ProtectedAction.BUILD);
    assertThat(write(alice, signOn(chest(5)), "", "16", "B 50", "coal").isCancelled()).isTrue();
  }

  @Test
  void theShopLimitFollowsTheShopkeeperLevel() {
    var alice = player("Alice", 1);
    for (var index = 0; index < 5; index++) {
      assertThat(write(alice, signOn(chest(index * 3)), "", "1", "B 5", "coal").isCancelled())
          .isFalse();
    }

    var sixth = write(alice, signOn(chest(30)), "", "1", "B 5", "coal");

    assertThat(sixth.isCancelled()).isTrue();
    assertThat(messages(alice)).last().asString().contains("already own 5 shops");
  }

  @Test
  void malformedSignsExplainEveryProblem() {
    var alice = player("Alice", 1);

    var event = write(alice, signOn(chest(0)), "", "0", "B 40:S 50", "unobtainium");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages(alice))
        .containsExactly(
            "[Shop]: Line 2 must be between 1 and 576, not 0.",
            "[Shop]: The sell price (50) must not be above the buy price (40).");
  }

  @Test
  void unknownItemsAreRefused() {
    var alice = player("Alice", 1);

    var event = write(alice, signOn(chest(0)), "", "1", "B 5", "unobtainium");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages(alice)).containsExactly("[Shop]: There is no item called \"unobtainium\".");
  }

  @Test
  void ordinarySignsAreLeftAlone() {
    var alice = player("Alice", 0);

    var event = write(alice, signOn(chest(0)), "Welcome", "to", "Aegis", "");

    assertThat(event.isCancelled()).isFalse();
    assertThat(lines(event)).containsExactly("Welcome", "to", "Aegis", "");
    assertThat(messages(alice)).isEmpty();
  }

  @Test
  void adminShopsNeedTheAdminPermissionButNoContainer() throws Exception {
    var alice = player("Alice", 5);
    var stone = world.getBlockAt(0, 64, 0);
    stone.setType(Material.STONE);

    assertThat(write(alice, signOn(stone), "Admin Shop", "1", "S 12", "emerald").isCancelled())
        .isTrue();
    assertThat(messages(alice)).containsExactly("[Shop]: Only admins can make admin shops.");

    var root = admin("Root");
    var event = write(root, signOn(stone), "admin shop", "1", "S 12", "emerald");
    tick(2);

    assertThat(event.isCancelled()).isFalse();
    assertThat(lines(event)).containsExactly("Admin Shop", "1", "S 12", "Emerald");
    assertThat(storedShops())
        .singleElement()
        .satisfies(shop -> assertThat(shop.isAdmin()).isTrue());
  }

  @Test
  void aShopSignCannotBeRewritten() {
    var alice = player("Alice", 1);
    var sign = shop(alice, chest(0), "", "16", "B 50", "coal");
    messages(alice);

    var edit = write(alice, sign, "", "1", "B 1", "coal");

    assertThat(edit.isCancelled()).isTrue();
    assertThat(messages(alice)).singleElement().asString().contains("cannot be edited");
  }

  @Test
  void anotherPlayersContainerCannotHostYourShop() {
    var alice = player("Alice", 1);
    var bob = player("Bob", 1);
    var chest = chest(0);
    shop(alice, chest, "", "16", "B 50", "coal");

    var west = chest.getRelative(org.bukkit.block.BlockFace.WEST);
    west.setType(Material.OAK_WALL_SIGN);
    var data = (org.bukkit.block.data.type.WallSign) west.getBlockData();
    data.setFacing(org.bukkit.block.BlockFace.WEST);
    west.setBlockData(data);
    var event = write(bob, west, "", "1", "S 1", "coal");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages(bob))
        .containsExactly("[Shop]: Another player's shop already uses that container.");
  }
}
