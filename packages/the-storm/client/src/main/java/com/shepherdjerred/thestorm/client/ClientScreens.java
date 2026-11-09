package com.shepherdjerred.thestorm.client;

import com.shepherdjerred.thestorm.client.mixin.ContainerScreenAccessor;
import java.util.Map;
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
  private record UiLimits(
      int minimumGuiScale, int maximumGuiScale, int minimumFrameCap, int maximumFrameCap) {
    UiLimits {
      if (minimumGuiScale < 1 || maximumGuiScale < minimumGuiScale)
        throw new IllegalArgumentException("Invalid GUI scale contract");
      if (minimumFrameCap < FrameClock.FPS
          || maximumFrameCap < minimumFrameCap
          || maximumFrameCap > 240)
        throw new IllegalArgumentException("Invalid frame cap contract");
    }
  }

  private static final UiLimits UI = loadUiLimits();

  private ClientScreens() {}

  private static UiLimits loadUiLimits() {
    try (var input =
        Objects.requireNonNull(ClientScreens.class.getResourceAsStream("/storm-docs-ui.json"))) {
      var contract = Protocol.JSON.readTree(input);
      Protocol.keys(
          contract,
          Set.of("minimumGuiScale", "maximumGuiScale", "minimumFrameCap", "maximumFrameCap"));
      return new UiLimits(
          Protocol.integer(contract, "minimumGuiScale", 1, 16),
          Protocol.integer(contract, "maximumGuiScale", 1, 16),
          Protocol.integer(contract, "minimumFrameCap", FrameClock.FPS, 240),
          Protocol.integer(contract, "maximumFrameCap", FrameClock.FPS, 240));
    } catch (java.io.IOException failure) {
      throw new java.io.UncheckedIOException("Cannot load docs UI contract", failure);
    }
  }

  static Object scale(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("scale"));
    var scale = Protocol.integer(args, "scale", UI.minimumGuiScale(), UI.maximumGuiScale());
    client.options.guiScale().set(scale);
    client.resizeGui();
    return "GUI scale updated";
  }

  static int frameCap(JsonNode args) {
    Protocol.keys(args, Set.of("fps"));
    return Protocol.integer(args, "fps", UI.minimumFrameCap(), UI.maximumFrameCap());
  }

  static Object frameCap(Minecraft client, JsonNode args) {
    client.options.framerateLimit().set(frameCap(args));
    return Map.of("fpsCap", client.options.framerateLimit().get());
  }

  static Object open(Minecraft client, String action, JsonNode args) {
    var tab = args.get("tab");
    Protocol.keys(args, tab == null ? Set.of() : Set.of("tab"));
    if (client.gui.screen() != null) throw new IllegalStateException("A screen is already open");
    if (action.equals("chat-open")) {
      if (tab != null) throw new IllegalArgumentException("Chat has no advancement tab");
      client.gui.setScreen(new ChatScreen("", false));
      // Keep the real command transcript readable when chat's first-open notice appears.
      client.gui.toastManager().clear();
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
