package com.shepherdjerred.thestorm.client;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;

final class ClientSnapshot {
  private ClientSnapshot() {}

  record Item(int slot, String type, int count, String name, String components) {}

  static Object read(Minecraft client) {
    var screen = client.gui.screen();
    var player = client.player;
    if (player == null || client.level == null) {
      return Map.of(
          "connected", false, "screen", screen == null ? "" : screen.getTitle().getString());
    }
    var inventory = new ArrayList<Item>();
    for (var i = 0; i < player.getInventory().getContainerSize(); i++) {
      inventory.add(item(i, player.getInventory().getItem(i)));
    }
    var container = player.containerMenu;
    var slots = new ArrayList<Item>();
    for (var i = 0; i < container.slots.size(); i++) {
      slots.add(item(i, container.slots.get(i).getItem()));
    }
    return Map.ofEntries(
        Map.entry("connected", true),
        Map.entry("position", List.of(player.getX(), player.getY(), player.getZ())),
        Map.entry("yaw", player.getYRot()),
        Map.entry("pitch", player.getXRot()),
        Map.entry("health", player.getHealth()),
        Map.entry("food", player.getFoodData().getFoodLevel()),
        Map.entry("world", client.level.dimension().identifier().toString()),
        Map.entry("hotbar", player.getInventory().getSelectedSlot()),
        Map.entry("screen", screen == null ? "" : screen.getTitle().getString()),
        Map.entry("containerId", container.containerId),
        Map.entry("stateId", container.getStateId()),
        Map.entry("cursor", item(-1, container.getCarried())),
        Map.entry("inventory", inventory),
        Map.entry("slots", slots),
        Map.entry("target", target(client)),
        Map.entry("fps", client.getFps()));
  }

  private static Item item(int slot, ItemStack stack) {
    return new Item(
        slot,
        BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
        stack.getCount(),
        stack.getHoverName().getString(),
        stack.getComponents().toString());
  }

  private static Object target(Minecraft client) {
    var hit = client.hitResult;
    if (hit instanceof BlockHitResult block
        && hit.getType() == net.minecraft.world.phys.HitResult.Type.BLOCK
        && client.level != null) {
      var pos = block.getBlockPos();
      return Map.of(
          "kind",
          "block",
          "position",
          List.of(pos.getX(), pos.getY(), pos.getZ()),
          "type",
          BuiltInRegistries.BLOCK.getKey(client.level.getBlockState(pos).getBlock()).toString());
    }
    if (hit instanceof EntityHitResult entity) {
      return Map.of(
          "kind",
          "entity",
          "id",
          entity.getEntity().getId(),
          "type",
          BuiltInRegistries.ENTITY_TYPE.getKey(entity.getEntity().getType()).toString());
    }
    return Map.of("kind", "miss");
  }
}
