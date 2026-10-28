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
  private NativeTemplateGeometry() {}

  static SkyTemplate describe(String key, SkyPosition size, List<NativeSkyTemplates.Cell> cells) {
    var blocks =
        cells.stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    NativeSkyTemplates.Cell::position, Function.identity()));
    var entry =
        key.startsWith("ancient_city/")
            ? connector(key, size)
            : door(cells, size).orElseGet(() -> connector(key, size));
    var occupied =
        SkyWorkshops.relative(key).stream()
            .map(e -> e.position())
            .collect(Collectors.toUnmodifiableSet());
    var residents =
        key.startsWith("village/") ? residents(blocks, occupied) : List.<SkyPosition>of();
    return new SkyTemplate(key, size, entry, residents, key.contains("city_center/") ? 9 : 0);
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

  private static SkyPosition connector(String key, SkyPosition size) {
    var links = java.util.Objects.requireNonNull(NativeSkyConnectors.LINKS.get(key));
    var edge =
        links.stream()
            .map(NativeSkyConnectors.Connector::position)
            .filter(p -> p.x() == 0 || p.z() == 0 || p.x() == size.x() - 1 || p.z() == size.z() - 1)
            .min(Comparator.comparingInt(SkyPosition::y));
    if (edge.isEmpty() && key.endsWith("plains_small_farm_1"))
      return new SkyPosition(-1, 1, size.z() / 2);
    if (edge.isEmpty()) throw new IllegalStateException("Native piece has no entrance " + key);
    var p = edge.orElseThrow();
    var face =
        p.x() == 0
            ? BlockFace.WEST
            : p.x() == size.x() - 1
                ? BlockFace.EAST
                : p.z() == 0 ? BlockFace.NORTH : BlockFace.SOUTH;
    return outside(new SkyPosition(p.x(), Math.max(1, p.y()), p.z()), face, size);
  }

  private static List<SkyPosition> residents(
      Map<SkyPosition, NativeSkyTemplates.Cell> cells, Set<SkyPosition> occupied) {
    var result = new ArrayList<SkyPosition>();
    var beds =
        cells.values().stream()
            .filter(c -> c.data() instanceof Bed b && b.getPart() == Bed.Part.HEAD)
            .sorted(
                Comparator.comparingInt((NativeSkyTemplates.Cell c) -> c.position().y())
                    .thenComparingInt(c -> c.position().x())
                    .thenComparingInt(c -> c.position().z()))
            .toList();
    for (var bed : beds) result.add(standing(bed.position(), cells, occupied));
    return List.copyOf(result);
  }

  private static SkyPosition standing(
      SkyPosition bed, Map<SkyPosition, NativeSkyTemplates.Cell> cells, Set<SkyPosition> occupied) {
    for (var offset :
        List.of(
            new SkyPosition(1, 0, 0),
            new SkyPosition(-1, 0, 0),
            new SkyPosition(0, 0, 1),
            new SkyPosition(0, 0, -1))) {
      var p = bed.add(offset);
      if (!occupied.contains(p) && clear(p, cells) && clear(p.above(1), cells) && floor(p, cells))
        return p;
    }
    throw new IllegalStateException("Native bed has no accessible standing position: " + bed);
  }

  private static boolean clear(SkyPosition p, Map<SkyPosition, NativeSkyTemplates.Cell> cells) {
    var block = cells.get(p);
    return block != null
        && (block.data().getMaterial().isAir()
            || block.data().getMaterial() == Material.GRAY_CARPET);
  }

  private static boolean floor(SkyPosition p, Map<SkyPosition, NativeSkyTemplates.Cell> cells) {
    var block = cells.get(p.above(-1));
    return block != null && block.data().getMaterial().isSolid();
  }
}
