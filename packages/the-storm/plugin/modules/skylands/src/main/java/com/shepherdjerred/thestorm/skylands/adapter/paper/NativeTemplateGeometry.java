package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyTemplate;
import com.shepherdjerred.thestorm.skylands.domain.SkyWorkshops;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Bed;
import org.bukkit.block.data.type.Door;

/** Derives entrances and standing positions from native blocks, without a world lookup. */
final class NativeTemplateGeometry {
  private record Room(
      String key,
      SkyPosition size,
      Map<SkyPosition, NativeSkyTemplates.Cell> cells,
      Set<SkyPosition> occupied) {}

  private NativeTemplateGeometry() {}

  static SkyTemplate describe(String key, SkyPosition size, List<NativeSkyTemplates.Cell> cells) {
    var blocks =
        cells.stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    NativeSkyTemplates.Cell::position, Function.identity()));
    var entry =
        key.startsWith("ancient_city/")
            ? connector(key, size, cells)
            : door(cells, size).orElseGet(() -> connector(key, size, cells));
    var occupied =
        SkyWorkshops.relative(key).stream()
            .map(e -> e.position())
            .collect(Collectors.toUnmodifiableSet());
    var residents =
        key.startsWith("village/")
            ? residents(new Room(key, size, blocks, occupied))
            : List.<SkyPosition>of();
    var joins =
        java.util.Objects.requireNonNull(NativeSkyConnectors.LINKS.get(key)).stream()
            .map(NativeSkyConnectors.Connector::join)
            .toList();
    return new SkyTemplate(key, size, entry, residents, 0, joins);
  }

  private static Optional<SkyPosition> door(List<NativeSkyTemplates.Cell> cells, SkyPosition size) {
    return cells.stream()
        .filter(c -> c.data() instanceof Door d && d.getHalf() == Bisected.Half.BOTTOM)
        .min(Comparator.comparingInt(c -> c.position().y()))
        .map(c -> outside(c.position(), ((Door) c.data()).getFacing(), size));
  }

  private static SkyPosition outside(SkyPosition p, BlockFace direction, SkyPosition size) {
    return switch (direction) {
      case WEST -> new SkyPosition(-1, p.y(), p.z());
      case EAST -> new SkyPosition(size.x(), p.y(), p.z());
      case NORTH -> new SkyPosition(p.x(), p.y(), -1);
      case SOUTH -> new SkyPosition(p.x(), p.y(), size.z());
      default -> throw new IllegalStateException("Non-horizontal native doorway");
    };
  }

  private static SkyPosition connector(
      String key, SkyPosition size, List<NativeSkyTemplates.Cell> cells) {
    var links = java.util.Objects.requireNonNull(NativeSkyConnectors.LINKS.get(key));
    var edge =
        links.stream()
            .filter(c -> c.join().direction().y() == 0)
            .min(Comparator.comparingInt(c -> c.position().y()));
    if (edge.isEmpty() && key.contains("farm")) return new SkyPosition(-1, 1, size.z() / 2);
    if (edge.isEmpty()) return openEdge(key, size, cells);
    var join = edge.orElseThrow().join();
    var p = join.position();
    var dir = join.direction();
    var face =
        dir.x() < 0
            ? BlockFace.WEST
            : dir.x() > 0 ? BlockFace.EAST : dir.z() < 0 ? BlockFace.NORTH : BlockFace.SOUTH;
    return outside(
        new SkyPosition(
            p.x(), key.startsWith("ancient_city/") ? p.y() + 1 : Math.max(1, p.y()), p.z()),
        face,
        size);
  }

  private static SkyPosition openEdge(
      String key, SkyPosition size, List<NativeSkyTemplates.Cell> cells) {
    if (key.contains("accessory")) return new SkyPosition(-1, 1, size.z() / 2);
    var blocks =
        cells.stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    NativeSkyTemplates.Cell::position, Function.identity()));
    var open =
        cells.stream()
            .map(NativeSkyTemplates.Cell::position)
            .filter(p -> p.y() >= 1 && p.y() <= 3)
            .filter(p -> p.x() == 0 || p.z() == 0 || p.x() == size.x() - 1 || p.z() == size.z() - 1)
            .filter(
                p -> clear(p, blocks, size) && clear(p.above(1), blocks, size) && floor(p, blocks))
            .min(
                Comparator.comparingInt(SkyPosition::y)
                    .thenComparingInt(SkyPosition::x)
                    .thenComparingInt(SkyPosition::z));
    if (open.isEmpty()) throw new IllegalStateException("Native piece has no entrance " + key);
    var p = open.orElseThrow();
    var face =
        p.x() == 0
            ? BlockFace.WEST
            : p.x() == size.x() - 1
                ? BlockFace.EAST
                : p.z() == 0 ? BlockFace.NORTH : BlockFace.SOUTH;
    return outside(p, face, size);
  }

  private static List<SkyPosition> residents(Room room) {
    var result = new ArrayList<SkyPosition>();
    var beds =
        room.cells().values().stream()
            .filter(c -> c.data() instanceof Bed b && b.getPart() == Bed.Part.HEAD)
            .sorted(
                Comparator.comparingInt((NativeSkyTemplates.Cell c) -> c.position().y())
                    .thenComparingInt(c -> c.position().x())
                    .thenComparingInt(c -> c.position().z()))
            .toList();
    var used = new java.util.HashSet<>(room.occupied());
    for (var bed : beds) {
      var p = standing(bed.position(), room, used);
      result.add(p);
      used.add(p);
    }
    return List.copyOf(result);
  }

  private static SkyPosition standing(SkyPosition bed, Room room, Set<SkyPosition> occupied) {
    var candidates = new ArrayList<SkyPosition>();
    for (var x = -3; x <= 3; x++) {
      for (var z = -3; z <= 3; z++) {
        for (var y = -1; y <= 1; y++) candidates.add(bed.add(new SkyPosition(x, y, z)));
      }
    }
    return candidates.stream()
        .filter(
            p ->
                !occupied.contains(p)
                    && clear(p, room.cells(), room.size())
                    && clear(p.above(1), room.cells(), room.size())
                    && floor(p, room.cells()))
        .min(
            Comparator.comparingLong((SkyPosition p) -> p.distanceSquared(bed))
                .thenComparingInt(SkyPosition::x)
                .thenComparingInt(SkyPosition::z)
                .thenComparingInt(SkyPosition::y))
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "Native bed has no accessible standing position: " + room.key() + " " + bed));
  }

  private static boolean clear(
      SkyPosition p, Map<SkyPosition, NativeSkyTemplates.Cell> cells, SkyPosition size) {
    if (p.x() < 0
        || p.z() < 0
        || p.y() < 0
        || p.x() >= size.x()
        || p.z() >= size.z()
        || p.y() >= size.y()) return false;
    var block = cells.get(p);
    // Native templates can omit empty cells. PlotFit guarantees this above-floor volume is air.
    return block == null
        || ((!block.data().getMaterial().isCollidable()
                && block.data().getMaterial() != Material.WATER
                && block.data().getMaterial() != Material.LAVA)
            || block.data().getMaterial().name().endsWith("_CARPET"));
  }

  private static boolean floor(SkyPosition p, Map<SkyPosition, NativeSkyTemplates.Cell> cells) {
    var block = cells.get(p.above(-1));
    return block != null && block.data().getMaterial().isSolid();
  }
}
