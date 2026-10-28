package com.shepherdjerred.thestorm.skylands.domain;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Seeded candidate search; no preview coordinates, spawn-relative exceptions or world reads. */
final class SkySiteSearch {
  record Request(SkyTemplate template, SkyPosition near, int radius, int verticalRange) {}

  private final TerrainWindow terrain;
  private final SkyBounds interior;
  private final PlotFit fit;
  private final Lcg48 random;

  SkySiteSearch(TerrainWindow terrain, SkyCell cell, long seed) {
    this.terrain = terrain;
    interior = cell.interior();
    fit = new PlotFit(terrain);
    random = new Lcg48(seed);
  }

  Optional<SkyPiece> find(Request request, List<SkyPiece> existing, int attempts) {
    for (var trial = 0; trial < attempts; trial++) {
      var x = request.near().x() + random.nextInt(request.radius() * 2 + 1) - request.radius();
      var z = request.near().z() + random.nextInt(request.radius() * 2 + 1) - request.radius();
      if (!interior.contains(new SkyPosition(x, 100, z))) continue;
      var surfaces =
          terrain.column(x, z).surfaces(36, 230).stream()
              .sorted(Comparator.comparingInt(y -> Math.abs(y - request.near().y())))
              .toList();
      var result = column(request, new SkyPosition(x, 0, z), surfaces, existing);
      if (result.isPresent()) return result;
    }
    return Optional.empty();
  }

  private Optional<SkyPiece> column(
      Request request, SkyPosition p, List<Integer> surfaces, List<SkyPiece> existing) {
    for (var surface : surfaces) {
      if (Math.abs(surface - request.near().y()) > request.verticalRange()) continue;
      var piece =
          new SkyPiece(
              request.template(), new SkyPosition(p.x(), surface, p.z()), random.nextInt(4));
      if (eligible(piece, existing)) return Optional.of(piece);
      if (request.template().embeddedHeight() > 0) {
        var buried = buried(request, piece, existing);
        if (buried.isPresent()) return buried;
      }
    }
    return Optional.empty();
  }

  private Optional<SkyPiece> buried(Request request, SkyPiece surface, List<SkyPiece> existing) {
    for (var depth : List.of(2, 4, 6, 8)) {
      var piece =
          new SkyPiece(request.template(), surface.origin().above(-depth), surface.quarterTurns());
      if (eligible(piece, existing)) return Optional.of(piece);
    }
    return Optional.empty();
  }

  private boolean eligible(SkyPiece piece, List<SkyPiece> existing) {
    return interior.contains(piece.bounds().min())
        && interior.contains(piece.bounds().max())
        && existing.stream().noneMatch(piece::overlaps)
        && fit.fits(piece)
        && terrain.footing(piece.entrance().above(-1), 3)
        && (piece.template().embeddedHeight() == 0 || embedded(piece));
  }

  private boolean embedded(SkyPiece piece) {
    int solid = 0, total = 0;
    var s = piece.size();
    for (var x = 0; x < s.x(); x += 2) {
      for (var z = 0; z < s.z(); z += 2) {
        for (var y = 0; y < 8; y += 2) {
          total++;
          if (terrain.solid(piece.origin().add(new SkyPosition(x, y, z)))) solid++;
        }
      }
    }
    return solid >= total * .72;
  }
}
