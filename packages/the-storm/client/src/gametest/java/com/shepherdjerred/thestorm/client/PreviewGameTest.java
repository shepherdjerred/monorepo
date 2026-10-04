package com.shepherdjerred.thestorm.client;

import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;

/** Checks Minecraft-specific snapshots and rendered menus in Fabric's real client framework. */
public final class PreviewGameTest implements FabricClientGameTest {
  public PreviewGameTest() {}

  @Override
  public void runTest(ClientGameTestContext context) {
    try (var world = context.worldBuilder().create()) {
      world.getConnection().waitForChunksRender();
      context.waitFor(client -> client.player != null && client.level != null);
      var state = context.computeOnClient(ClientSnapshot::read);
      var node = Protocol.JSON.valueToTree(state);
      if (!node.required("connected").booleanValue()) {
        throw new IllegalStateException("Snapshot did not observe the loaded world");
      }
      context.getInput().pressKey(options -> options.keyInventory);
      context.waitForScreen(InventoryScreen.class);
      context.takeScreenshot("preview-inventory");
    }
  }
}
