package com.shepherdjerred.thestorm.rwf.adapter.content.details;

import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Explicitly allowed map payloads. Positions are relative to the schematic's minimum corner. */
public record MapDetails(
    int version, String blocksSha256, List<Container> containers, List<Sign> signs) {
  private static final Set<String> COLORS =
      Set.of(
          "WHITE",
          "ORANGE",
          "MAGENTA",
          "LIGHT_BLUE",
          "YELLOW",
          "LIME",
          "PINK",
          "GRAY",
          "LIGHT_GRAY",
          "CYAN",
          "PURPLE",
          "BLUE",
          "BROWN",
          "GREEN",
          "RED",
          "BLACK");

  public MapDetails {
    if (version != 1 || !blocksSha256.matches("[a-f0-9]{64}"))
      throw new IllegalArgumentException("invalid map details version or terrain hash");
    containers = List.copyOf(containers);
    signs = List.copyOf(signs);
    if (containers.size() + signs.size() > 16_384)
      throw new IllegalArgumentException("too many map details");
    var positions = new HashSet<BlockPos>();
    for (var container : containers) unique(positions, container.at());
    for (var sign : signs) unique(positions, sign.at());
  }

  private static void unique(HashSet<BlockPos> positions, BlockPos at) {
    if (!positions.add(at))
      throw new IllegalArgumentException("duplicate map detail position " + at);
  }

  public static MapDetails empty(String hash) {
    return new MapDetails(1, hash, List.of(), List.of());
  }

  public record Container(BlockPos at, String material, String items) {
    public Container {
      MapDetails.material(material);
      if (items.isEmpty() || items.length() > 5_592_408)
        throw new IllegalArgumentException("invalid serialized inventory size");
      if (Base64.getDecoder().decode(items).length > 4_194_304)
        throw new IllegalArgumentException("serialized inventory is too large");
    }
  }

  public record Face(List<String> lines, String color, boolean glowing) {
    public Face {
      lines = List.copyOf(lines);
      if (lines.size() != 4 || lines.stream().anyMatch(line -> line.length() > 16_384))
        throw new IllegalArgumentException("a sign face requires four bounded text lines");
      if (!COLORS.contains(color)) throw new IllegalArgumentException("unknown sign color");
    }
  }

  public record Sign(BlockPos at, String material, Face front, Face back, boolean waxed) {
    public Sign {
      MapDetails.material(material);
      if (front == null || back == null) throw new IllegalArgumentException("missing sign face");
    }
  }

  private static void material(String value) {
    if (!value.matches("minecraft:[a-z0-9_]+"))
      throw new IllegalArgumentException("invalid map detail material");
  }

  public void validate(Schematic blocks) {
    if (!blocksSha256.equals(blocks.sha256()))
      throw new IllegalArgumentException("map details terrain hash mismatch");
    for (var container : containers) validate(blocks, container.at(), container.material());
    for (var sign : signs) validate(blocks, sign.at(), sign.material());
  }

  private static void validate(Schematic blocks, BlockPos at, String material) {
    var state = blocks.blockState(at.x(), at.y(), at.z());
    if (!state.equals(material) && !state.startsWith(material + "["))
      throw new IllegalArgumentException("map detail material differs from terrain at " + at);
  }
}
