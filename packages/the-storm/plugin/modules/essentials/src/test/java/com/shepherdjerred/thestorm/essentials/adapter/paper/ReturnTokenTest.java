package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Material;
import org.bukkit.entity.Item;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class ReturnTokenTest {
  private ServerMock server;
  private PlayerMock player;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    player = server.addPlayer();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void anOccupiedSlotMovesAsideWhenStorageHasRoom() {
    var kept = new ItemStack(Material.DIAMOND, 64);
    player.getInventory().setItem(ReturnToken.SLOT, kept);
    ReturnToken.place(player, ReturnToken.item(player, player.getLocation(), 5));
    assertThat(player.getInventory().getItem(0)).isEqualTo(kept);
    assertThat(ReturnToken.marked(player.getInventory().getItem(ReturnToken.SLOT))).isTrue();
  }

  @Test
  void aFullInventoryKeepsTheOccupiedSlotAndDropsTheReturn() {
    var kept = new ItemStack(Material.DIAMOND, 64);
    for (var slot = 0; slot < 36; slot++) {
      player.getInventory().setItem(slot, kept.clone());
    }
    ReturnToken.place(player, ReturnToken.item(player, player.getLocation(), 5));
    assertThat(player.getInventory().getItem(ReturnToken.SLOT)).isEqualTo(kept);
    assertThat(player.getWorld().getEntitiesByClass(Item.class))
        .anyMatch(dropped -> ReturnToken.marked(dropped.getItemStack()));
  }
}
