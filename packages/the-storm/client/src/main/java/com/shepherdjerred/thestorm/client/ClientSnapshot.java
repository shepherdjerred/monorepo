package com.shepherdjerred.thestorm.client;

import static java.util.Objects.requireNonNull;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.chunk.CompiledSectionMesh;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.util.Util;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import org.jspecify.annotations.Nullable;

final class ClientSnapshot {
  private ClientSnapshot() {}

  record Item(int slot, String type, int count, String name, String components) {}

  static Object read(Minecraft client) {
    var screen = client.gui.screen();
    var player = client.player;
    if (player == null || client.level == null) {
      return Map.of(
          "connected", false,
          "screen", screen == null ? "" : screen.getTitle().getString(),
          "renderedFrames", RenderCapture.renderedFrames(),
          "fps", client.getFps(),
          "servers", servers(client));
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
        Map.entry("clientLoaded", requireNonNull(client.getConnection()).hasClientLoaded()),
        Map.entry("renderedFrames", RenderCapture.renderedFrames()),
        Map.entry(
            "terrainReady",
            requireNonNull(client.getConnection()).hasClientLoaded()
                && terrainLoaded(client)
                && client.levelRenderer.hasRenderedAllSections()
                && terrainVisible(client)),
        Map.entry("chunkStats", client.level.gatherChunkSourceStats()),
        Map.entry("uuid", player.getUUID().toString()),
        Map.entry("name", player.getName().getString()),
        Map.entry("position", List.of(player.getX(), player.getY(), player.getZ())),
        Map.entry("yaw", player.getYRot()),
        Map.entry("pitch", player.getXRot()),
        Map.entry("health", player.getHealth()),
        Map.entry("food", player.getFoodData().getFoodLevel()),
        Map.entry("world", client.level.dimension().identifier().toString()),
        Map.entry("hotbar", player.getInventory().getSelectedSlot()),
        Map.entry("swinging", player.isSwinging()),
        Map.entry("crouching", player.isCrouching()),
        Map.entry("eyeHeight", player.getEyeHeight()),
        Map.entry("screen", screen == null ? "" : screen.getTitle().getString()),
        Map.entry("containerId", container.containerId),
        Map.entry("stateId", container.getStateId()),
        Map.entry("cursor", item(-1, container.getCarried())),
        Map.entry("inventory", inventory),
        Map.entry("slots", slots),
        Map.entry("target", target(client)),
        Map.entry("fps", client.getFps()));
  }

  private static List<Object> servers(Minecraft client) {
    var result = new ArrayList<Object>();
    if (client.gui.screen()
        instanceof net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen screen) {
      var servers = screen.getServers();
      for (var i = 0; i < servers.size(); i++) {
        var server = servers.get(i);
        result.add(
            Map.of(
                "name",
                server.name,
                "address",
                server.ip,
                "state",
                server.state().name(),
                "ping",
                server.ping,
                "motd",
                server.motd == null ? "" : server.motd.getString(),
                "iconPixelsSha256",
                iconSha256(server.getIconBytes())));
      }
    }
    return result;
  }

  private static String iconSha256(byte @Nullable [] icon) {
    if (icon == null) return "";
    try {
      var image = requireNonNull(ImageIO.read(new ByteArrayInputStream(icon)));
      var digest = MessageDigest.getInstance("SHA-256");
      for (var y = 0; y < image.getHeight(); y++) {
        for (var x = 0; x < image.getWidth(); x++) {
          var rgba = image.getRGB(x, y);
          digest.update((byte) (rgba >> 16));
          digest.update((byte) (rgba >> 8));
          digest.update((byte) rgba);
          digest.update((byte) (rgba >> 24));
        }
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException | IOException error) {
      throw new IllegalStateException("Server icon could not be fingerprinted", error);
    }
  }

  private static boolean terrainLoaded(Minecraft client) {
    var player = requireNonNull(client.player);
    var level = requireNonNull(client.level);
    var chunk = player.chunkPosition();
    for (var x = chunk.x() - 1; x <= chunk.x() + 1; x++) {
      for (var z = chunk.z() - 1; z <= chunk.z() + 1; z++) {
        if (!level.hasChunk(x, z)) return false;
      }
    }
    return true;
  }

  private static boolean terrainVisible(Minecraft client) {
    var sections = client.levelRenderer.visibleSections();
    if (sections.isEmpty()) return false;
    var now = Util.getMillis();
    var fade = Util.toMillis(client.options.chunkSectionFadeInTime().get());
    return sections.stream()
        .allMatch(
            section ->
                !CompiledSectionMesh.UNCOMPILED.equals(section.getSectionMesh())
                    && section.getVisibility(now, fade) >= 1.0f);
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
          "hit",
          List.of(block.getLocation().x, block.getLocation().y, block.getLocation().z),
          "type",
          BuiltInRegistries.BLOCK.getKey(client.level.getBlockState(pos).getBlock()).toString());
    }
    if (hit instanceof EntityHitResult entity) {
      var target = entity.getEntity();
      var box = target.getBoundingBox();
      return Map.of(
          "kind",
          "entity",
          "id",
          entity.getEntity().getId(),
          "type",
          BuiltInRegistries.ENTITY_TYPE.getKey(target.getType()).toString(),
          "uuid",
          target.getUUID().toString(),
          "bounds",
          Map.of(
              "min",
              List.of(box.minX, box.minY, box.minZ),
              "max",
              List.of(box.maxX, box.maxY, box.maxZ)),
          "variant",
          target instanceof net.minecraft.world.entity.decoration.painting.Painting painting
              ? painting.getVariant().unwrapKey().orElseThrow().identifier().toString()
              : "");
    }
    return Map.of("kind", "miss");
  }
}
