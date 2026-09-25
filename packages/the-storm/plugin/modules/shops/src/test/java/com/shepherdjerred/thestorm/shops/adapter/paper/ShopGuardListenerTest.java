package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import io.papermc.paper.event.player.PlayerOpenSignEvent;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;

final class ShopGuardListenerTest extends ShopsFixture {

  private BlockBreakEvent breakBlock(Player player, Block block) {
    var event = new BlockBreakEvent(block, player);
    server.getPluginManager().callEvent(event);
    return event;
  }

  private BlockPlaceEvent place(Player player, Block block, Material type) {
    var replaced = block.getState();
    block.setType(type);
    var event =
        new BlockPlaceEvent(
            block,
            replaced,
            block.getRelative(BlockFace.DOWN),
            ItemStack.of(type),
            player,
            true,
            EquipmentSlot.HAND);
    server.getPluginManager().callEvent(event);
    return event;
  }

  @Test
  void onlyTheOwnerAndAdminsOpenAShopContainer() {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var root = admin("Root");
    var chest = chest(0);
    shop(alice, chest, "", "16", "B 50", "coal");
    messages(bob);

    var bobs = click(bob, chest, Action.RIGHT_CLICK_BLOCK);
    var alices = click(alice, chest, Action.RIGHT_CLICK_BLOCK);
    var roots = click(root, chest, Action.RIGHT_CLICK_BLOCK);

    assertThat(bobs.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(alices.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(roots.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(messages(bob)).containsExactly("[Shop]: This container belongs to Alice.");
  }

  @Test
  void theLockHoldsWhateverTheLandAllows() {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    shop(alice, chest, "", "16", "B 50", "coal");

    // Land protection allows everything here, as a claim with open containers would.
    assertThat(plugin.protection.denied).isEmpty();
    assertThat(click(bob, chest, Action.RIGHT_CLICK_BLOCK).useInteractedBlock())
        .isEqualTo(Event.Result.DENY);
  }

  @Test
  void ordinaryContainersAreNotLocked() {
    var bob = player("Bob", 0);

    assertThat(click(bob, chest(0), Action.RIGHT_CLICK_BLOCK).useInteractedBlock())
        .isNotEqualTo(Event.Result.DENY);
  }

  @Test
  void onlyTheOwnerOrAnAdminBreaksAShop() throws Exception {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    messages(bob);

    assertThat(breakBlock(bob, sign).isCancelled()).isTrue();
    assertThat(breakBlock(bob, chest).isCancelled()).isTrue();
    assertThat(messages(bob)).containsOnly("[Shop]: This shop belongs to Alice.");
    assertThat(storedShops()).hasSize(1);

    assertThat(breakBlock(alice, sign).isCancelled()).isFalse();
    tick(2);
    assertThat(storedShops()).isEmpty();
  }

  @Test
  void breakingTheContainerRemovesEveryShopOnIt() throws Exception {
    var alice = player("Alice", 2);
    var root = admin("Root");
    var chest = chest(0);
    shop(alice, chest, "", "16", "B 50", "coal");
    var west = chest.getRelative(BlockFace.WEST);
    west.setType(Material.OAK_WALL_SIGN);
    var data = (org.bukkit.block.data.type.WallSign) west.getBlockData();
    data.setFacing(BlockFace.WEST);
    west.setBlockData(data);
    assertThat(write(alice, west, "", "1", "S 1", "coal").isCancelled()).isFalse();
    tick(2);
    assertThat(storedShops()).hasSize(2);

    assertThat(breakBlock(root, chest).isCancelled()).isFalse();
    tick(2);

    assertThat(storedShops()).isEmpty();
    assertThat(messages(root)).contains("[Shop]: Shops removed.");
  }

  @Test
  void othersCannotHangAHopperUnderAShopOrJoinItsChest() {
    var alice = player("Alice", 1);
    var bob = player("Bob", 0);
    var chest = chest(0);
    shop(alice, chest, "", "16", "B 50", "coal");
    messages(bob);

    var hopper = place(bob, chest.getRelative(BlockFace.DOWN), Material.HOPPER);
    var ownHopper = place(alice, chest.getRelative(BlockFace.DOWN), Material.HOPPER);
    var elsewhere = place(bob, world.getBlockAt(50, 64, 0), Material.HOPPER);

    assertThat(hopper.isCancelled()).isTrue();
    assertThat(ownHopper.isCancelled()).isFalse();
    assertThat(elsewhere.isCancelled()).isFalse();
    assertThat(messages(bob)).containsExactly("[Shop]: That would reach into Alice.");
  }

  @Test
  void shopSignsNeverOpenTheSignEditor() {
    var alice = player("Alice", 1);
    var sign = shop(alice, chest(0), "", "16", "B 50", "coal");
    var plainSign = signOn(chest(5));

    var shopEdit =
        new PlayerOpenSignEvent(
            alice, (Sign) sign.getState(), Side.FRONT, PlayerOpenSignEvent.Cause.INTERACT);
    var plainEdit =
        new PlayerOpenSignEvent(
            alice, (Sign) plainSign.getState(), Side.FRONT, PlayerOpenSignEvent.Cause.INTERACT);
    server.getPluginManager().callEvent(shopEdit);
    server.getPluginManager().callEvent(plainEdit);

    assertThat(shopEdit.isCancelled()).isTrue();
    assertThat(plainEdit.isCancelled()).isFalse();
  }

  @Test
  void explosionsSpareShopBlocks() {
    var alice = player("Alice", 1);
    var chest = chest(0);
    var sign = shop(alice, chest, "", "16", "B 50", "coal");
    var dirt = world.getBlockAt(20, 64, 0);
    dirt.setType(Material.DIRT);
    var blocks = new ArrayList<Block>(List.of(chest, sign, dirt));

    var event =
        new org.bukkit.event.block.BlockExplodeEvent(
            dirt, dirt.getState(), blocks, 1f, org.bukkit.ExplosionResult.DESTROY);
    server.getPluginManager().callEvent(event);

    assertThat(event.blockList()).containsExactly(dirt);
  }
}
