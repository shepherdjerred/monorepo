package com.shepherdjerred.mcbridge.adapter.worldedit;

import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.world.block.BlockState;
import com.sk89q.worldedit.world.block.BlockType;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockSupport;
import org.bukkit.block.data.BlockData;

/** Exhaustive Paper state lighting, stored as defaults plus differing states. */
final class BlockLighting {
  private static final BlockFace[] FACES = {
    BlockFace.NORTH, BlockFace.SOUTH, BlockFace.EAST,
    BlockFace.WEST, BlockFace.UP, BlockFace.DOWN
  };

  private BlockLighting() {}

  static JsonObject collect(BlockType type) {
    JsonObject defaults = value(type.getDefaultState());
    JsonObject overrides = new JsonObject();
    for (BlockState state : type.getAllStates()) {
      JsonObject lighting = value(state);
      if (!lighting.equals(defaults)) overrides.add(state.getAsString(), lighting);
    }
    JsonObject result = new JsonObject();
    result.addProperty("states", type.getAllStates().size());
    result.add("default", defaults);
    result.add("overrides", overrides);
    return result;
  }

  private static JsonObject value(BlockState state) {
    BlockData data = BukkitAdapter.adapt(state);
    JsonObject result = new JsonObject();
    result.addProperty("emission", data.getLightEmission());
    result.addProperty(
        "transmits",
        !state.getBlockType().id().equals("minecraft:tinted_glass") && !fullOpaque(data));
    return result;
  }

  // canOcclude alone also includes fences and slabs. The cell-level light
  // approximation blocks only opaque states with six complete support faces.
  private static boolean fullOpaque(BlockData data) {
    if (!data.isOccluding()) return false;
    for (BlockFace face : FACES) {
      if (!data.isFaceSturdy(face, BlockSupport.FULL)) return false;
    }
    return true;
  }
}
