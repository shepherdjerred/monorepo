package com.shepherdjerred.thestorm.skylands.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Sparse geometry shared by every planned district; no writes outside the owning cell. */
final class SkyEdits {
  private final SkyBounds area;
  private final Map<SkyPosition, SkyPlan.Edit> values = new LinkedHashMap<>();

  SkyEdits(SkyCell cell) {
    area = cell.interior();
  }

  void set(SkyPosition p, String block) {
    add(new SkyPlan.Edit(p, "minecraft:" + block));
  }

  void add(SkyPlan.Edit edit) {
    if (!area.contains(edit.position()))
      throw new IllegalArgumentException("Edit escaped feature cell");
    values.put(edit.position(), edit);
  }

  List<SkyPlan.Edit> finish() {
    return values.values().stream().map(this::connections).toList();
  }

  boolean contains(SkyPosition p) {
    return values.containsKey(p);
  }

  private SkyPlan.Edit connections(SkyPlan.Edit edit) {
    if (!edit.block().endsWith("_fence")) return edit;
    var p = edit.position();
    var faces =
        "[north="
            + connects(p.add(new SkyPosition(0, 0, -1)))
            + ",east="
            + connects(p.add(new SkyPosition(1, 0, 0)))
            + ",south="
            + connects(p.add(new SkyPosition(0, 0, 1)))
            + ",west="
            + connects(p.add(new SkyPosition(-1, 0, 0)))
            + "]";
    return new SkyPlan.Edit(p, edit.block() + faces, edit.phase());
  }

  private boolean connects(SkyPosition p) {
    var edit = values.get(p);
    if (edit == null) return false;
    var type = edit.block().split("\\[", 2)[0];
    return type.endsWith("_fence")
        || type.endsWith("_log")
        || type.endsWith("_planks")
        || java.util.Set.of(
                "minecraft:stone", "minecraft:cobblestone", "minecraft:cobbled_deepslate")
            .contains(type);
  }

  void foundation(SkyPiece piece, TerrainWindow terrain) {
    var size = piece.size();
    for (var x = 0; x < size.x(); x++) {
      for (var z = 0; z < size.z(); z++) {
        foundationColumn(piece.origin().add(new SkyPosition(x, 0, z)), terrain);
      }
    }
  }

  private void foundationColumn(SkyPosition p, TerrainWindow terrain) {
    for (var d = 0; d < 3; d++) {
      var q = p.above(-d);
      if (!terrain.solid(q))
        add(new SkyPlan.Edit(q, "minecraft:cobblestone", SkyPlan.Phase.FOUNDATION));
    }
  }

  void workshops(SkyPiece piece) {
    for (var edit : SkyWorkshops.relative(piece.template().key())) {
      // Rotated block states are applied by the Paper adapter with the piece's rotation.
      var block = rotate(edit.block(), piece.quarterTurns());
      add(new SkyPlan.Edit(piece.at(edit.position()), block));
    }
  }

  static String rotate(String block, int turns) {
    var faces = List.of("north", "east", "south", "west");
    for (var i = 0; i < faces.size(); i++) {
      var facing = "facing=" + faces.get(i);
      if (block.contains(facing))
        return block.replace(facing, "facing=" + faces.get((i + turns) % 4));
    }
    return block;
  }

  void farmLights(SkyPiece piece) {
    if (!piece.template().key().contains("farm")) return;
    var width = piece.template().size().x();
    var depth = piece.template().size().z();
    for (var z = 2; z < depth - 1; z++) {
      if ((z - 2) % 4 != 0 && z != depth - 3) continue;
      arbor(piece, z, width);
    }
  }

  private void arbor(SkyPiece piece, int z, int width) {
    for (var x : List.of(0, width - 1)) {
      for (var y = 1; y < 4; y++) set(piece.at(new SkyPosition(x, y, z)), "oak_log[axis=y]");
    }
    for (var x = 0; x < width; x++) {
      var axis = piece.quarterTurns() % 2 == 0 ? "x" : "z";
      set(piece.at(new SkyPosition(x, 4, z)), "oak_log[axis=" + axis + "]");
    }
    for (var x = 1; x < width - 1; x++) {
      if ((x - 1) % 4 == 0 || x == width - 2)
        set(piece.at(new SkyPosition(x, 3, z)), "lantern[hanging=true]");
    }
  }
}
