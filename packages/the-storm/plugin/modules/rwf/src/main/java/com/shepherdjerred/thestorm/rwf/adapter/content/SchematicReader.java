package com.shepherdjerred.thestorm.rwf.adapter.content;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/**
 * Reads a Sponge schematic, version 3, from its gzipped NBT: the {@code Schematic} compound's
 * {@code Width}, {@code Height}, {@code Length}, and {@code Blocks} with a {@code Palette} and
 * varint {@code Data}. Block entities and entities are refused: a map is terrain only, so nothing
 * inside it can hold items or run logic.
 */
public final class SchematicReader {

  static final int VERSION = 3;

  private SchematicReader() {}

  /** Reads {@code gzipped}, or throws describing the first problem. */
  public static Schematic read(InputStream gzipped) {
    try (var in = new DataInputStream(new BufferedInputStream(new GZIPInputStream(gzipped)))) {
      return interpret(Nbt.readRoot(in));
    } catch (IOException e) {
      throw new UncheckedIOException("blocks.schem is not a readable gzipped NBT file", e);
    }
  }

  static Schematic interpret(Map<String, Object> root) {
    var schematic = compound(root, "Schematic");
    var version = integer(schematic, "Version");
    if (version != VERSION) {
      throw new IllegalArgumentException(
          "blocks.schem is Sponge schematic version " + version + "; only " + VERSION + " is read");
    }
    var width = dimension(schematic, "Width");
    var height = dimension(schematic, "Height");
    var length = dimension(schematic, "Length");
    var blocks = compound(schematic, "Blocks");
    if (blocks.get("BlockEntities") instanceof List<?> entities && !entities.isEmpty()) {
      throw new IllegalArgumentException(
          "blocks.schem holds " + entities.size() + " block entities; maps are terrain only");
    }
    if (schematic.get("Entities") instanceof List<?> entities && !entities.isEmpty()) {
      throw new IllegalArgumentException(
          "blocks.schem holds " + entities.size() + " entities; maps are terrain only");
    }
    var palette = palette(compound(blocks, "Palette"));
    var data = blocks.get("Data");
    if (!(data instanceof byte[] bytes)) {
      throw new IllegalArgumentException("Blocks.Data is missing or not a byte array");
    }
    var size = new Schematic.Dimensions(width, height, length);
    return new Schematic(size, palette, varints(bytes, (int) size.blocks()));
  }

  private static List<String> palette(Map<String, Object> entries) {
    var palette = new ArrayList<String>();
    for (var i = 0; i < entries.size(); i++) {
      palette.add("");
    }
    for (var entry : entries.entrySet()) {
      if (!(entry.getValue() instanceof Integer index)) {
        throw new IllegalArgumentException("palette entry " + entry.getKey() + " is not an int");
      }
      if (index < 0 || index >= palette.size() || !palette.get(index).isEmpty()) {
        throw new IllegalArgumentException(
            "palette indices must be 0.." + (palette.size() - 1) + " each once; saw " + index);
      }
      palette.set(index, entry.getKey());
    }
    return palette;
  }

  /** Unsigned LEB128 varints, exactly {@code count} of them, using every byte. */
  static int[] varints(byte[] bytes, int count) {
    var values = new int[count];
    var position = 0;
    for (var i = 0; i < count; i++) {
      var value = 0;
      var shift = 0;
      while (true) {
        if (position >= bytes.length) {
          throw new IllegalArgumentException("Blocks.Data ends after " + i + " of " + count);
        }
        var b = bytes[position++];
        value |= (b & 0x7F) << shift;
        if ((b & 0x80) == 0) {
          break;
        }
        shift += 7;
        if (shift > 28) {
          throw new IllegalArgumentException("Blocks.Data holds a varint wider than an int");
        }
      }
      values[i] = value;
    }
    if (position != bytes.length) {
      throw new IllegalArgumentException(
          "Blocks.Data has " + (bytes.length - position) + " bytes beyond the last block");
    }
    return values;
  }

  private static Map<String, Object> compound(Map<String, Object> parent, String key) {
    var value = parent.get(key);
    if (value instanceof Map<?, ?> map) {
      var compound = new LinkedHashMap<String, Object>();
      map.forEach((name, child) -> compound.put(String.valueOf(name), child));
      return compound;
    }
    throw new IllegalArgumentException(key + " is missing or not a compound");
  }

  private static int integer(Map<String, Object> parent, String key) {
    if (parent.get(key) instanceof Integer value) {
      return value;
    }
    throw new IllegalArgumentException(key + " is missing or not an int");
  }

  private static int dimension(Map<String, Object> parent, String key) {
    if (parent.get(key) instanceof Short value) {
      var dimension = Short.toUnsignedInt(value);
      if (dimension < 1) {
        throw new IllegalArgumentException(key + " must be positive");
      }
      return dimension;
    }
    throw new IllegalArgumentException(key + " is missing or not a short");
  }
}
