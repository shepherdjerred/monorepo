package com.shepherdjerred.thestorm.client;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import tools.jackson.databind.JsonNode;

/** All state access and ordinary game actions happen on Minecraft's client thread. */
final class ClientActions {
  private final Session session;
  private final InputLease inputs = new InputLease();
  private final Captures captures;

  ClientActions(Session session) {
    this.session = session;
    captures = new Captures(session.artifacts());
  }

  CompletableFuture<Object> submit(Minecraft client, UUID peer, Protocol.Request request) {
    var args = request.arguments();
    if (request.action().equals("status")) {
      Protocol.keys(args, Set.of());
      var state = Protocol.JSON.valueToTree(ClientSnapshot.read(client));
      var object = (tools.jackson.databind.node.ObjectNode) state;
      object.set("heldInputs", Protocol.JSON.valueToTree(inputs.buttons()));
      object.put("pid", ProcessHandle.current().pid());
      return CompletableFuture.completedFuture(object);
    }
    if (request.action().equals("shutdown")) {
      Protocol.keys(args, Set.of());
      release(client);
      client.stop();
      return CompletableFuture.completedFuture("Client stopping");
    }
    if (request.action().equals("release")) {
      Protocol.keys(args, Set.of());
      release(client);
      return CompletableFuture.completedFuture("Inputs released");
    }
    requireWorld(client);
    if (request.action().equals("capture")) return captures.capture(client, args);
    if (request.action().equals("input")) return input(client, peer, args);
    var result =
        switch (request.action()) {
          case "look" -> look(client, args);
          case "hotbar" -> hotbar(client, args);
          case "inventory" -> inventory(client, args);
          case "close" -> close(client, args);
          case "click" -> click(client, args);
          case "command" -> command(client, args);
          case "attack", "use" -> interact(client, request);
          default -> throw new IllegalArgumentException("Unknown action: " + request.action());
        };
    return CompletableFuture.completedFuture(result);
  }

  void tick(Minecraft client) {
    if (client.player == null || client.player.isDeadOrDying() || client.gui.screen() != null) {
      release(client);
    } else {
      inputs.tick();
      apply(client);
    }
  }

  void disconnect(Minecraft client, UUID peer) {
    inputs.disconnect(peer);
    apply(client);
  }

  void release(Minecraft client) {
    inputs.release();
    apply(client);
  }

  private void requireWorld(Minecraft client) {
    var server = client.getCurrentServer();
    if (client.player == null
        || client.level == null
        || client.gameMode == null
        || server == null
        || !server.ip.equals(session.server())) {
      throw new IllegalStateException("Dedicated preview world is not ready");
    }
  }

  private CompletableFuture<Object> input(Minecraft client, UUID peer, JsonNode args) {
    Protocol.keys(args, Set.of("buttons", "ticks"));
    if (client.gui.screen() != null)
      throw new IllegalStateException("Close the screen before movement");
    var requested = args.required("buttons");
    if (!requested.isArray()) throw new IllegalArgumentException("buttons must be an array");
    var buttons = new HashSet<String>();
    for (var button : requested) {
      if (!button.isString()) throw new IllegalArgumentException("Invalid button");
      buttons.add(button.stringValue());
    }
    var result = inputs.start(peer, buttons, Protocol.integer(args, "ticks", 1, 100));
    apply(client);
    if (buttons.contains("attack")) KeyMapping.click(client.options.keyAttack.getDefaultKey());
    if (buttons.contains("use")) KeyMapping.click(client.options.keyUse.getDefaultKey());
    return result;
  }

  private void apply(Minecraft client) {
    var options = client.options;
    var keys =
        Map.of(
            "forward",
            options.keyUp,
            "back",
            options.keyDown,
            "left",
            options.keyLeft,
            "right",
            options.keyRight,
            "jump",
            options.keyJump,
            "sneak",
            options.keyShift,
            "sprint",
            options.keySprint,
            "attack",
            options.keyAttack,
            "use",
            options.keyUse);
    keys.forEach((name, key) -> key.setDown(inputs.buttons().contains(name)));
  }

  private static Object look(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("yaw", "pitch"));
    var player = java.util.Objects.requireNonNull(client.player);
    player.setYRot(Protocol.angle(args, "yaw", -360, 360));
    player.setXRot(Protocol.angle(args, "pitch", -90, 90));
    return "Camera updated";
  }

  private static Object hotbar(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("slot"));
    java.util.Objects.requireNonNull(client.player)
        .getInventory()
        .setSelectedSlot(Protocol.integer(args, "slot", 0, 8));
    return "Hotbar selected";
  }

  private static Object inventory(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("open"));
    var value = args.required("open");
    if (!value.isBoolean()) throw new IllegalArgumentException("open must be boolean");
    var player = java.util.Objects.requireNonNull(client.player);
    if (value.booleanValue()) {
      if (client.gui.screen() != null) throw new IllegalStateException("A screen is already open");
      client.gui.setScreen(new InventoryScreen(player));
    } else player.closeContainer();
    return "Inventory updated";
  }

  private static Object click(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("containerId", "stateId", "slot", "button", "mode"));
    var player = java.util.Objects.requireNonNull(client.player);
    var menu = player.containerMenu;
    if (client.gui.screen() == null
        || Protocol.integer(args, "containerId", 0, Integer.MAX_VALUE) != menu.containerId
        || Protocol.integer(args, "stateId", 0, Integer.MAX_VALUE) != menu.getStateId()) {
      throw new IllegalStateException("Container changed; inspect it again");
    }
    var slot = Protocol.integer(args, "slot", 0, menu.slots.size() - 1);
    var button = Protocol.integer(args, "button", 0, 1);
    var mode =
        switch (Protocol.text(args, "mode", 20)) {
          case "pickup" -> ContainerInput.PICKUP;
          case "quick_move" -> ContainerInput.QUICK_MOVE;
          default -> throw new IllegalArgumentException("Invalid click mode");
        };
    java.util.Objects.requireNonNull(client.gameMode)
        .handleContainerInput(menu.containerId, slot, button, mode, player);
    return "Container click sent";
  }

  private static Object close(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of());
    var screen = client.gui.screen();
    if (screen != null) screen.onClose();
    return "Screen closed";
  }

  private static Object command(Minecraft client, JsonNode args) {
    Protocol.keys(args, Set.of("text"));
    var text = Protocol.text(args, "text", 256);
    if (text.indexOf('\n') != -1 || text.indexOf('\r') != -1 || text.startsWith("/")) {
      throw new IllegalArgumentException("Provide a command without slash or newlines");
    }
    java.util.Objects.requireNonNull(client.getConnection()).sendCommand(text);
    return "Command sent";
  }

  private static Object interact(Minecraft client, Protocol.Request request) {
    Protocol.keys(request.arguments(), Set.of());
    if (client.gui.screen() != null)
      throw new IllegalStateException("Close the screen to interact");
    var player = java.util.Objects.requireNonNull(client.player);
    var mode = java.util.Objects.requireNonNull(client.gameMode);
    var hit = client.hitResult;
    if (request.action().equals("attack")) {
      if (!(hit instanceof EntityHitResult entity))
        throw new IllegalStateException("Aim at an entity");
      mode.attack(player, entity.getEntity());
    } else if (hit instanceof BlockHitResult block
        && hit.getType() == net.minecraft.world.phys.HitResult.Type.BLOCK) {
      mode.useItemOn(player, InteractionHand.MAIN_HAND, block);
    } else if (hit instanceof EntityHitResult entity) {
      mode.interact(player, entity.getEntity(), entity, InteractionHand.MAIN_HAND);
    } else mode.useItem(player, InteractionHand.MAIN_HAND);
    player.swing(InteractionHand.MAIN_HAND);
    return "Interaction sent";
  }
}
