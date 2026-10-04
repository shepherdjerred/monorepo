package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.event.inventory.InventoryAction;
import org.junit.jupiter.api.Test;

final class ParcelInventoryListenerTest {
  @Test
  void gracePeriodBlocksActionsThatAddItemsToTheProtectedInventory() {
    for (var action :
        new InventoryAction[] {
          InventoryAction.PLACE_ALL,
          InventoryAction.PLACE_ONE,
          InventoryAction.PLACE_SOME,
          InventoryAction.SWAP_WITH_CURSOR,
          InventoryAction.HOTBAR_SWAP
        }) {
      assertThat(ParcelInventoryListener.addsItemsToTop(action, true))
          .as("%s on the protected inventory", action)
          .isTrue();
    }
  }

  @Test
  void gracePeriodAllowsWithdrawalsAndBlocksShiftMovingItemsIntoTheProtectedInventory() {
    assertThat(
            ParcelInventoryListener.addsItemsToTop(
                InventoryAction.MOVE_TO_OTHER_INVENTORY, true))
        .isFalse();
    assertThat(
            ParcelInventoryListener.addsItemsToTop(
                InventoryAction.MOVE_TO_OTHER_INVENTORY, false))
        .isTrue();
    assertThat(ParcelInventoryListener.addsItemsToTop(InventoryAction.PICKUP_ALL, true))
        .isFalse();
    assertThat(ParcelInventoryListener.addsItemsToTop(InventoryAction.COLLECT_TO_CURSOR, true))
        .isFalse();
  }
}
