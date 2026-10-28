package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Native socket connections keep the city's central architecture intact on suitable terrain. */
final class SkyAssembly {
  private record Socket(SkyPiece piece, SkyJoin join) {}

  private final TerrainWindow terrain;
  private final List<SkyTemplate> templates;
  private final SkyBounds bounds;
  private final long seed;

  SkyAssembly(TerrainWindow terrain, List<SkyTemplate> templates, SkyBounds bounds, long seed) {
    this.terrain = terrain;
    this.templates = templates.stream().sorted(Comparator.comparing(SkyTemplate::key)).toList();
    this.bounds = bounds;
    this.seed = seed;
  }

  List<SkyPiece> grow(SkyPiece root) {
    var pieces = new ArrayList<SkyPiece>();
    pieces.add(root);
    var pending = new ArrayDeque<Socket>();
    append(pending, root);
    while (!pending.isEmpty() && pieces.size() < 18) {
      var socket = pending.remove();
      var candidates = candidates(socket);
      for (var child : candidates) {
        if (child.origin().distanceSquared(root.origin()) > 10000 || !fits(child, pieces)) continue;
        pieces.add(child);
        append(pending, child);
        break;
      }
    }
    return List.copyOf(pieces);
  }

  private static void append(ArrayDeque<Socket> pending, SkyPiece piece) {
    for (var join : piece.template().joins()) {
      if (join.direction().y() == 0 && !join.pool().equals("minecraft:empty"))
        pending.add(new Socket(piece, join));
    }
  }

  private List<SkyPiece> candidates(Socket socket) {
    var out = new ArrayList<SkyPiece>();
    var pool = socket.join().pool().replace("minecraft:", "") + "/";
    for (var template : templates) {
      if (!template.key().startsWith(pool)) continue;
      for (var join : template.joins()) {
        if (!join.name().equals(socket.join().target())) continue;
        out.addAll(attach(socket, template, join));
      }
    }
    out.sort(
        Comparator.comparingLong(
            p -> SkyRandom.hash(p.origin(), seed + p.template().key().hashCode())));
    return out;
  }

  private static List<SkyPiece> attach(Socket socket, SkyTemplate template, SkyJoin join) {
    var out = new ArrayList<SkyPiece>();
    var parent = socket.piece();
    var facing = parent.direction(socket.join().direction());
    var target = parent.at(socket.join().position()).add(facing);
    for (var turn = 0; turn < 4; turn++) {
      var local = new SkyPiece(template, new SkyPosition(0, 0, 0), turn);
      if (!local.direction(join.direction()).equals(new SkyPosition(-facing.x(), 0, -facing.z())))
        continue;
      var offset = local.at(join.position());
      out.add(
          new SkyPiece(
              template, target.add(new SkyPosition(-offset.x(), -offset.y(), -offset.z())), turn));
    }
    return out;
  }

  private boolean fits(SkyPiece piece, List<SkyPiece> existing) {
    return bounds.contains(piece.bounds().min())
        && bounds.contains(piece.bounds().max())
        && existing.stream().noneMatch(p -> p.bounds().intersects(piece.bounds()))
        && new PlotFit(terrain).fits(piece);
  }

  static int centerWalls(List<SkyPiece> pieces) {
    if (pieces.isEmpty()) return 0;
    var root = pieces.getFirst();
    return (int)
        root.template().joins().stream()
            .filter(join -> join.direction().y() == 0)
            .filter(
                join ->
                    pieces.stream()
                        .skip(1)
                        .anyMatch(
                            child ->
                                child.template().joins().stream()
                                    .anyMatch(
                                        other ->
                                            join.target().equals(other.name())
                                                && root.at(join.position())
                                                    .add(root.direction(join.direction()))
                                                    .equals(child.at(other.position()))
                                                && root.direction(join.direction())
                                                    .add(child.direction(other.direction()))
                                                    .equals(new SkyPosition(0, 0, 0)))))
            .count();
  }
}
