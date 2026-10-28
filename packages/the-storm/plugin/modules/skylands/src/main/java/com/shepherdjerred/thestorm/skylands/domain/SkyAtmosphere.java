package com.shepherdjerred.thestorm.skylands.domain;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Terrain-following sculk and small village gardens unite native pieces with their surroundings.
 */
final class SkyAtmosphere {
  private final TerrainWindow terrain;
  private final SkyEdits edits;
  private final SkyCell cell;
  private final Set<SkyPosition> visited = new HashSet<>();

  SkyAtmosphere(TerrainWindow terrain, SkyEdits edits, SkyCell cell) {
    this.terrain = terrain;
    this.edits = edits;
    this.cell = cell;
  }

  void apply(List<SkyPiece> pieces, boolean city) {
    for (var piece : pieces) {
      var bounds = piece.bounds().expanded(city ? 14 : 4);
      for (var x = bounds.min().x(); x <= bounds.max().x(); x++) {
        for (var z = bounds.min().z(); z <= bounds.max().z(); z++)
          column(pieces, piece, new SkyPosition(x, 0, z), city);
      }
    }
  }

  private void column(List<SkyPiece> pieces, SkyPiece piece, SkyPosition column, boolean city) {
    for (var y :
        terrain
            .column(column.x(), column.z())
            .surfaces(piece.origin().y() - 10, piece.origin().y() + 10)) {
      var p = new SkyPosition(column.x(), y, column.z());
      if (!eligible(pieces, p) || !visited.add(p)) continue;
      var noise = SkyRandom.noise(p.x() / 11.0, p.y() / 13.0, p.z() / 11.0, terrain.seed() + 2801);
      if (city && distance(p, pieces) < 10 + 5 * noise) city(p, noise);
      else if (!city && noise > .1) garden(p);
    }
  }

  private static double distance(SkyPosition p, List<SkyPiece> pieces) {
    return pieces.stream()
        .mapToDouble(
            piece -> {
              var b = piece.bounds();
              var dx = Math.max(0, Math.max(b.min().x() - p.x(), p.x() - b.max().x()));
              var dz = Math.max(0, Math.max(b.min().z() - p.z(), p.z() - b.max().z()));
              return Math.hypot(dx, dz) + Math.abs(p.y() - piece.origin().y()) * .5;
            })
        .min()
        .orElseThrow();
  }

  private boolean eligible(List<SkyPiece> pieces, SkyPosition p) {
    return cell.interior().contains(p.above(2))
        && cell.interior().contains(p)
        && !edits.contains(p)
        && !edits.contains(p.above(1))
        && !edits.contains(p.above(2))
        && pieces.stream().noneMatch(piece -> piece.bounds().expanded(1).contains(p))
        && terrain.air(p.above(1))
        && terrain.air(p.above(2));
  }

  private void city(SkyPosition p, double noise) {
    edits.set(p, noise > -.03 ? "sculk" : "cobbled_deepslate");
    if (noise <= -.03 && noise > -.19) edits.set(p.above(1), "sculk_vein[down=true]");
    var hash = SkyRandom.hash(p, terrain.seed() + 2819);
    if (Math.floorMod(hash, 113) == 0) edits.set(p.above(1), "candle[candles=3,lit=true]");
  }

  private void garden(SkyPosition p) {
    var hash = SkyRandom.hash(p, terrain.seed() + 2833);
    if (Math.floorMod(hash, 7) != 0) return;
    var biome = new LayeredClimate(terrain.seed()).biome(p.above(1), terrain.column(p.x(), p.z()));
    if (SkyVillagePalette.family(biome).equals("desert")) {
      edits.set(p.above(1), Math.floorMod(hash, 3) == 0 ? "decorated_pot" : "dead_bush");
    } else {
      var flowers = List.of("short_grass", "short_grass", "fern", "poppy", "dandelion", "azalea");
      edits.set(p.above(1), flowers.get(Math.floorMod(hash, flowers.size())));
    }
  }
}
