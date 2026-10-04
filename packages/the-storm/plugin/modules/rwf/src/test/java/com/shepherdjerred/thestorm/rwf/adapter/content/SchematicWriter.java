package com.shepherdjerred.thestorm.rwf.adapter.content;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.zip.GZIPOutputStream;

/**
 * Writes a {@link Schematic} as a Sponge v3 schematic: gzipped NBT with the same layout {@link
 * SchematicReader} reads. Test-only: the plugin never writes maps.
 */
public final class SchematicWriter {

  /** The Minecraft data version the sample maps claim; the reader ignores it. */
  static final int DATA_VERSION = 4325;

  private SchematicWriter() {}

  public static byte[] write(Schematic schematic) {
    var bytes = new ByteArrayOutputStream();
    try (var out = new DataOutputStream(new GZIPOutputStream(bytes))) {
      out.writeByte(Nbt.COMPOUND);
      out.writeUTF("");
      compound(out, "Schematic");
      integer(out, "Version", SchematicReader.VERSION);
      integer(out, "DataVersion", DATA_VERSION);
      shortTag(out, "Width", schematic.width());
      shortTag(out, "Height", schematic.height());
      shortTag(out, "Length", schematic.length());
      out.writeByte(Nbt.INT_ARRAY);
      out.writeUTF("Offset");
      out.writeInt(3);
      out.writeInt(0);
      out.writeInt(0);
      out.writeInt(0);
      compound(out, "Blocks");
      compound(out, "Palette");
      var palette = schematic.palette();
      for (var i = 0; i < palette.size(); i++) {
        integer(out, palette.get(i), i);
      }
      out.writeByte(Nbt.END);
      out.writeByte(Nbt.BYTE_ARRAY);
      out.writeUTF("Data");
      var data = varints(schematic);
      out.writeInt(data.length);
      out.write(data);
      out.writeByte(Nbt.LIST);
      out.writeUTF("BlockEntities");
      out.writeByte(Nbt.END);
      out.writeInt(0);
      out.writeByte(Nbt.END); // Blocks
      out.writeByte(Nbt.END); // Schematic
      out.writeByte(Nbt.END); // root
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return bytes.toByteArray();
  }

  private static byte[] varints(Schematic schematic) {
    var out = new ByteArrayOutputStream();
    for (var i = 0; i < schematic.blockCount(); i++) {
      var value = schematic.paletteIndexAt(i);
      while ((value & ~0x7F) != 0) {
        out.write((value & 0x7F) | 0x80);
        value >>>= 7;
      }
      out.write(value);
    }
    return out.toByteArray();
  }

  private static void compound(DataOutputStream out, String name) throws IOException {
    out.writeByte(Nbt.COMPOUND);
    out.writeUTF(name);
  }

  private static void integer(DataOutputStream out, String name, int value) throws IOException {
    out.writeByte(Nbt.INT);
    out.writeUTF(name);
    out.writeInt(value);
  }

  private static void shortTag(DataOutputStream out, String name, int value) throws IOException {
    out.writeByte(Nbt.SHORT);
    out.writeUTF(name);
    out.writeShort(value);
  }
}
