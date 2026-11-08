package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.junit.jupiter.api.Test;

final class ShopLoadingTest extends ShopsFixture {
  @Test
  void legacyShopClickExplainsLoadingWithoutAffectingOrdinarySigns() {
    var player = player("Visitor", 0);
    var blocks = new ShopBlocks(plugin, ShopRegistry.loading(), Set.of(Material.CHEST));
    var legacy = signOn(chest(0));
    var sign = (Sign) legacy.getState();
    sign.getSide(Side.FRONT).line(0, Component.text("[Buy]"));
    sign.update();
    var event =
        new PlayerInteractEvent(
            player, Action.RIGHT_CLICK_BLOCK, null, legacy, BlockFace.SOUTH, EquipmentSlot.HAND);
    ShopClickListener.loading(event, blocks, legacy);
    assertThat(event.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(messages(player)).contains("[Shop]: Shops are loading. Please try again shortly.");

    var ordinary = signOn(chest(3));
    var other =
        new PlayerInteractEvent(
            player, Action.RIGHT_CLICK_BLOCK, null, ordinary, BlockFace.SOUTH, EquipmentSlot.HAND);
    ShopClickListener.loading(other, blocks, ordinary);
    assertThat(other.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(messages(player)).isEmpty();
  }
}
