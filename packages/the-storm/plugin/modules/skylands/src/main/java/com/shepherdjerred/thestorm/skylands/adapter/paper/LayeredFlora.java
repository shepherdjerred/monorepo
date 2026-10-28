package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.TreeType;
import org.bukkit.block.BlockState;
import org.bukkit.block.TileState;

/**
 * Native trees are captured and accepted as a whole, so foliage cannot grow through planned routes.
 */
final class LayeredFlora {
  private final LayeredLandscape landscape;
  private final LayeredBlocks blocks;

  LayeredFlora(LayeredLandscape landscape, LayeredBlocks blocks) {
    this.landscape = landscape;
    this.blocks = blocks;
  }

  void populate(LayeredSlice slice, SkyPosition spawn) {
    var mask = new HashSet<SkyPosition>();
    for (var edit : slice.plan().edits()) mask.add(edit.position());
    for (var sample = 0; sample < 3; sample++) {
      var key =
          SkyRandom.hash(new SkyPosition(slice.x(), sample, slice.z()), landscape.seed() + 2441);
      var x = slice.x() * 16 + 4 + Math.floorMod(key, 8);
      var z = slice.z() * 16 + 4 + Math.floorMod(SkyRandom.mix(key), 8);
      for (var y : landscape.column(x, z).surfaces(36, 240)) {
        var p = new SkyPosition(x, y + 1, z);
        if (reserved(slice, p, mask) || p.distanceSquared(spawn) < 100) continue;
        surface(slice, p, mask);
      }
    }
  }

  private void surface(LayeredSlice slice, SkyPosition p, Set<SkyPosition> mask) {
    var hash = SkyRandom.hash(p, landscape.seed() + 2447);
    var biome = slice.region().getBiome(p.x(), p.y(), p.z()).getKey().getKey();
    if (biome.equals("deep_dark") || biome.contains("caves")) return;
    if (SkyRandom.unit(hash) < .3) tree(slice, p, new TreeRequest(tree(biome), hash, mask));
    else plant(slice, p, hash);
  }

  private record TreeRequest(TreeType type, long seed, Set<SkyPosition> mask) {}

  private void tree(LayeredSlice slice, SkyPosition p, TreeRequest request) {
    var ground = slice.region().getBlockData(p.x(), p.y() - 1, p.z());
    if (ground.getMaterial() == Material.SNOW_BLOCK) {
      slice.region().setBlockData(p.x(), p.y() - 1, p.z(), blocks.get("minecraft:grass_block"));
    }
    var proposed = new ArrayList<BlockState>();
    var random = Random.from(SkyRandom.generator(request.seed()));
    Predicate<BlockState> capture =
        state -> {
          proposed.add(state);
          return false;
        };
    slice
        .region()
        .generateTree(
            new Location(slice.region().getWorld(), p.x(), p.y(), p.z()),
            random,
            request.type(),
            capture);
    if (proposed.isEmpty() || proposed.stream().anyMatch(s -> blocked(slice, s, request.mask()))) {
      slice.region().setBlockData(p.x(), p.y() - 1, p.z(), ground);
      return;
    }
    for (var state : proposed) {
      slice.region().setBlockData(state.getX(), state.getY(), state.getZ(), state.getBlockData());
      if (state instanceof TileState)
        slice.region().setBlockState(state.getX(), state.getY(), state.getZ(), state);
    }
  }

  private static boolean blocked(LayeredSlice slice, BlockState state, Set<SkyPosition> mask) {
    var p = new SkyPosition(state.getX(), state.getY(), state.getZ());
    return !slice.owns(p) || reserved(slice, p, mask);
  }

  private static boolean reserved(LayeredSlice slice, SkyPosition p, Set<SkyPosition> mask) {
    return mask.contains(p)
        || slice.plan().pieces().stream().anyMatch(piece -> piece.bounds().expanded(1).contains(p));
  }

  private void plant(LayeredSlice slice, SkyPosition p, long hash) {
    var ground = slice.region().getType(p.x(), p.y() - 1, p.z());
    if (ground != Material.GRASS_BLOCK || !slice.region().getType(p.x(), p.y(), p.z()).isAir())
      return;
    var kinds = List.of("short_grass", "short_grass", "dandelion", "poppy", "cornflower");
    slice
        .region()
        .setBlockData(
            p.x(),
            p.y(),
            p.z(),
            blocks.get("minecraft:" + kinds.get(Math.floorMod(hash, kinds.size()))));
  }

  private static TreeType tree(String biome) {
    if (biome.contains("deep_dark")
        || biome.contains("caves")
        || biome.contains("desert")
        || biome.contains("badlands")) return TreeType.TREE;
    if (biome.contains("mushroom")) return TreeType.RED_MUSHROOM;
    if (biome.contains("taiga") || biome.contains("snow")) return TreeType.REDWOOD;
    if (biome.contains("cherry")) return TreeType.CHERRY;
    if (biome.contains("pale")) return TreeType.PALE_OAK_CREAKING;
    if (biome.contains("birch")) return TreeType.BIRCH;
    if (biome.contains("jungle")) return TreeType.SMALL_JUNGLE;
    return TreeType.TREE;
  }
}
