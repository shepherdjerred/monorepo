package com.shepherdjerred.thestorm.client;

import com.shepherdjerred.thestorm.client.mixin.ContainerScreenAccessor;
import java.util.Objects;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.advancements.AdvancementsScreen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.resources.Identifier;
import tools.jackson.databind.JsonNode;

/** Ordinary screen controls used to capture readable help and real item tooltips. */
final class ClientScreens {
  private ClientScreens() {}

  static Object open(Minecraft client, String action, JsonNode args) {
    var tab = args.get("tab");
    Protocol.keys(args, tab == null ? Set.of() : Set.of("tab"));
    if (client.gui.screen() != null) throw new IllegalStateException("A screen is already open");
    if (action.equals("chat-open")) {
      if (tab != null) throw new IllegalArgumentException("Chat has no advancement tab");
      client.gui.setScreen(new ChatScreen("", false));
    } else {
      var advancements = Objects.requireNonNull(client.getConnection()).getAdvancements();
      var root =
          tab == null ? null : advancements.get(Identifier.parse(Protocol.text(args, "tab", 256)));
      if (tab != null
          && (root == null || !root.value().isRoot() || root.value().display().isEmpty()))
        throw new IllegalArgumentException("Unknown visible advancement root");
      client.gui.setScreen(new AdvancementsScreen(advancements));
      if (root != null) advancements.setSelectedTab(root, true);
    }
    return "Screen opened";
  }

  static Object hover(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("containerId", "stateId", "slot"));
    var player = Objects.requireNonNull(client.player);
    var menu = player.containerMenu;
    if (!(client.gui.screen() instanceof AbstractContainerScreen<?> screen)
        || Protocol.integer(args, "containerId", 0, Integer.MAX_VALUE) != menu.containerId
        || Protocol.integer(args, "stateId", 0, Integer.MAX_VALUE) != menu.getStateId())
      throw new IllegalStateException("Container changed; inspect it again");
    var slot = menu.slots.get(Protocol.integer(args, "slot", 0, menu.slots.size() - 1));
    if (!slot.isActive()) throw new IllegalStateException("Slot is hidden");
    var layout = (ContainerScreenAccessor) screen;
    var window = client.getWindow();
    var x =
        (layout.stormLeft() + slot.x + 8.0) * window.getScreenWidth() / window.getGuiScaledWidth();
    var y =
        (layout.stormTop() + slot.y + 8.0) * window.getScreenHeight() / window.getGuiScaledHeight();
    client.mouseHandler.onMove(window.handle(), x, y, 0, 0);
    return "Pointer moved to container slot";
  }
}
