package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyPiece;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyRandom;
import org.bukkit.block.TileState;
import org.bukkit.block.data.Ageable;
import org.bukkit.block.structure.StructureRotation;
import org.bukkit.loot.Lootable;

/** Copies native piece cells and their loot/component snapshots, clipped to the owner chunk. */
final class LayeredPiecePlacement {
  private final NativeSkyTemplates templates;
  private final LayeredBlocks blocks;
  private final long seed;

  LayeredPiecePlacement(NativeSkyTemplates templates, LayeredBlocks blocks, long seed) {
    this.templates = templates;
    this.blocks = blocks;
    this.seed = seed;
  }

  void place(LayeredSlice slice) {
    for (var piece : slice.plan().pieces()) {
      if (piece.bounds().containsChunk(slice.x(), slice.z())) place(slice, piece);
    }
  }

  private void place(LayeredSlice slice, SkyPiece piece) {
    var rotation = rotation(piece.quarterTurns());
    for (var cell : templates.template(piece.template().key()).cells()) {
      var p = piece.at(cell.position());
      if (!slice.owns(p)) continue;
      var data = cell.data().clone();
      if (data instanceof Ageable && piece.template().key().contains("farm")) {
        data = crop(cell.position());
      }
      data.rotate(rotation);
      slice.region().setBlockData(p.x(), p.y(), p.z(), data);
      if (cell.snapshot() instanceof TileState && cell.snapshot().getType() == data.getMaterial()) {
        var tile = cell.snapshot().copy();
        tile.setBlockData(data);
        if (tile instanceof Lootable loot && loot.getLootTable() != null) {
          loot.setSeed(SkyRandom.hash(p, seed + 2203));
        }
        slice.region().setBlockState(p.x(), p.y(), p.z(), tile);
      }
    }
  }

  private org.bukkit.block.data.BlockData crop(SkyPosition p) {
    var crops = java.util.List.of("wheat", "carrots", "potatoes", "beetroots");
    var crop =
        (Ageable) blocks.get("minecraft:" + crops.get(Math.floorMod(p.x() + p.z(), 4))).clone();
    crop.setAge(crop.getMaximumAge());
    return crop;
  }

  static StructureRotation rotation(int turns) {
    return switch (turns) {
      case 0 -> StructureRotation.NONE;
      case 1 -> StructureRotation.CLOCKWISE_90;
      case 2 -> StructureRotation.CLOCKWISE_180;
      case 3 -> StructureRotation.COUNTERCLOCKWISE_90;
      default -> throw new IllegalArgumentException("Invalid quarter turns");
    };
  }
}
