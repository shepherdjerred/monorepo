package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.Objects;
import org.bukkit.Material;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.permissions.PermissionDefault;
import org.junit.jupiter.api.Test;

/** The server owner is an op who plays as a normal player. */
final class ShopsPermissionsTest extends ShopsFixture {

  private PermissionDefault defaultOf(String node) {
    return Objects.requireNonNull(server.getPluginManager().getPermission(node), node).getDefault();
  }

  @Test
  void everyNodeIsRegisteredWithAnExplicitDefault() {
    assertThat(defaultOf(ShopsPermissions.ADMIN)).isEqualTo(PermissionDefault.FALSE);
    assertThat(defaultOf(ShopsPermissions.OPEN_CATALOG)).isEqualTo(PermissionDefault.OP);
    for (var level = 1; level <= Track.MAX_LEVEL; level++) {
      assertThat(defaultOf(Track.SHOPKEEPER.permission(level))).isEqualTo(PermissionDefault.FALSE);
    }
  }

  @Test
  void anOpWithNoNodesGetsNoShopkeeperLevelsNoAdminShopsAndNoLockBypass() {
    var alice = player("Alice", 1);
    var chest = chest(0);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    var owner = server.addPlayer("Owner");
    owner.setOp(true);

    var chestShop = write(owner, signOn(chest(5)), "", "1", "B 5", "coal");
    var stone = world.getBlockAt(10, 64, 0);
    stone.setType(Material.STONE);
    var adminShop = write(owner, signOn(stone), "Admin Shop", "1", "S 1", "coal");
    var open = click(owner, chest, Action.RIGHT_CLICK_BLOCK);
    var breaking = new BlockBreakEvent(sign, owner);
    server.getPluginManager().callEvent(breaking);

    assertThat(ShopsPermissions.shopkeeperLevel(owner)).isZero();
    assertThat(chestShop.isCancelled()).isTrue();
    assertThat(adminShop.isCancelled()).isTrue();
    assertThat(open.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(breaking.isCancelled()).isTrue();
    assertThat(messages(owner))
        .contains(
            "[Shop]: You need Shopkeeper I to open a chest shop.",
            "[Shop]: Only admins can make admin shops.",
            "[Shop]: This container belongs to Alice.",
            "[Shop]: This shop belongs to Alice.");
  }

  @Test
  void anOpMayStillUseTheStaffCommand() {
    var owner = server.addPlayer("Owner");
    owner.setOp(true);

    server.dispatchCommand(owner, "shop nowhere");

    assertThat(messages(owner)).anySatisfy(line -> assertThat(line).contains("No shop called"));
  }
}
