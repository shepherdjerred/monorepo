package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyTemplate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.BlockState;
import org.bukkit.block.data.BlockData;

/** Snapshot native assets once at startup; each population call copies its own tile snapshots. */
public final class NativeSkyTemplates {
  record Cell(SkyPosition position, BlockState snapshot, BlockData data) {}

  record Template(SkyTemplate geometry, List<Cell> cells) {
    Template {
      cells = List.copyOf(cells);
    }
  }

  private final Map<String, Template> templates;

  private NativeSkyTemplates(Map<String, Template> templates) {
    this.templates = Map.copyOf(templates);
  }

  public static NativeSkyTemplates load() {
    var result = new TreeMap<String, Template>();
    for (var key : new java.util.TreeSet<>(NativeSkyConnectors.LINKS.keySet())) {
      result.put(key, load(key));
    }
    return new NativeSkyTemplates(result);
  }

  private static Template load(String key) {
    var structure =
        Objects.requireNonNull(
            Bukkit.getStructureManager().loadStructure(NamespacedKey.minecraft(key)),
            "Missing native Skylands template " + key);
    var links = new HashMap<SkyPosition, BlockData>();
    for (var link : Objects.requireNonNull(NativeSkyConnectors.LINKS.get(key))) {
      links.put(link.position(), Bukkit.createBlockData(link.block()));
    }
    var blocks = structure.getPalettes().getFirst().getBlocks();
    var cells = cells(blocks, links);
    var size = structure.getSize();
    var dimensions = new SkyPosition(size.getBlockX(), size.getBlockY(), size.getBlockZ());
    return new Template(NativeTemplateGeometry.describe(key, dimensions, cells), cells);
  }

  private static List<Cell> cells(List<BlockState> blocks, Map<SkyPosition, BlockData> links) {
    var result = new ArrayList<Cell>();
    var used = new java.util.HashSet<SkyPosition>();
    for (var block : blocks) {
      var p = new SkyPosition(block.getX(), block.getY(), block.getZ());
      if (block.getType() == Material.STRUCTURE_VOID) continue;
      var data = block.getBlockData();
      if (block.getType() == Material.JIGSAW) {
        data = Objects.requireNonNull(links.get(p), "Unrecognized native jigsaw " + p);
        used.add(p);
      }
      result.add(new Cell(p, block, data));
    }
    if (!used.equals(links.keySet()))
      throw new IllegalStateException("Native jigsaw contract changed");
    return List.copyOf(result);
  }

  public List<SkyTemplate> geometry() {
    return templates.values().stream()
        .map(Template::geometry)
        .sorted(java.util.Comparator.comparing(SkyTemplate::key))
        .toList();
  }

  Template template(String key) {
    return Objects.requireNonNull(templates.get(key), "Unknown Skylands template " + key);
  }
}
