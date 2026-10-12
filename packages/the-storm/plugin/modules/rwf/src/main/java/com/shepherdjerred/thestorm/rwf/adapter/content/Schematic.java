package com.shepherdjerred.thestorm.rwf.adapter.content;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * The blocks of a map, as a Sponge schematic stores them: a palette of block-state strings and one
 * palette index per block in {@code y, z, x} order. Immutable; the index array is copied in and
 * never handed out.
 *
 * <p>{@link #sha256()} names the exact terrain: it digests the dimensions, the palette in index
 * order and every index, so two schematics hash alike exactly when they place the same block states
 * in the same places.
 */
public final class Schematic {

  private final int width;
  private final int height;
  private final int length;
  private final List<String> palette;
  private final int[] indices;

  /**
   * The size of a schematic.
   *
   * @param width blocks along x
   * @param height blocks along y
   * @param length blocks along z
   */
  public record Dimensions(int width, int height, int length) {

    public Dimensions {
      if (width < 1 || height < 1 || length < 1) {
        throw new IllegalArgumentException("dimensions must be positive");
      }
    }

    public long blocks() {
      return (long) width * height * length;
    }
  }

  /**
   * @param size the dimensions
   * @param palette block-state strings such as {@code minecraft:stone}, by palette index
   * @param indices one palette index per block, {@code (y * length + z) * width + x}
   */
  public Schematic(Dimensions size, List<String> palette, int[] indices) {
    if (size.blocks() != indices.length) {
      throw new IllegalArgumentException(
          "expected " + size.blocks() + " blocks, got " + indices.length);
    }
    this.palette = List.copyOf(palette);
    if (this.palette.isEmpty()) {
      throw new IllegalArgumentException("palette must not be empty");
    }
    for (var entry : this.palette) {
      if (entry.isBlank()) {
        throw new IllegalArgumentException("palette entries must not be blank");
      }
    }
    for (var index : indices) {
      if (index < 0 || index >= this.palette.size()) {
        throw new IllegalArgumentException("palette index out of range: " + index);
      }
    }
    this.width = size.width();
    this.height = size.height();
    this.length = size.length();
    this.indices = indices.clone();
  }

  public int width() {
    return width;
  }

  public int height() {
    return height;
  }

  public int length() {
    return length;
  }

  public List<String> palette() {
    return palette;
  }

  public Dimensions size() {
    return new Dimensions(width, height, length);
  }

  public int blockCount() {
    return indices.length;
  }

  /** The array position of the block at relative {@code (x, y, z)}. */
  public int index(int x, int y, int z) {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= length) {
      throw new IllegalArgumentException(
          "block (" + x + "," + y + "," + z + ") is outside the schematic");
    }
    return (y * length + z) * width + x;
  }

  /** The palette index of the block at relative {@code (x, y, z)}. */
  public int paletteIndex(int x, int y, int z) {
    return indices[index(x, y, z)];
  }

  /** The palette index at array position {@code position}. */
  public int paletteIndexAt(int position) {
    return indices[position];
  }

  /** The block-state string at relative {@code (x, y, z)}. */
  public String blockState(int x, int y, int z) {
    return palette.get(paletteIndex(x, y, z));
  }

  /** The hex SHA-256 of the dimensions, palette and indices; see the class comment. */
  public String sha256() {
    return sha256(size(), palette, indices);
  }

  /** {@link #sha256()} for a candidate the verifier read back from the world. */
  public static String sha256(Dimensions size, List<String> palette, int[] indices) {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      digest.update(
          ("sponge-v3\n" + size.width() + " " + size.height() + " " + size.length() + "\n")
              .getBytes(StandardCharsets.UTF_8));
      for (var i = 0; i < palette.size(); i++) {
        digest.update((i + "\t" + palette.get(i) + "\n").getBytes(StandardCharsets.UTF_8));
      }
      var buffer = ByteBuffer.allocate(indices.length * Integer.BYTES);
      for (var index : indices) {
        buffer.putInt(index);
      }
      digest.update(buffer.array());
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required by Java", impossible);
    }
  }
}
