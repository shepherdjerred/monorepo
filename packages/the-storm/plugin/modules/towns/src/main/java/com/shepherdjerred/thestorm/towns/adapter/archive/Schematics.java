package com.shepherdjerred.thestorm.towns.adapter.archive;

import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;

/** Supported WorldEdit schematic format, encoded from detached snapshots off the server thread. */
public final class Schematics {
  private Schematics() {}

  public static byte[] encode(Clipboard clipboard) {
    var bytes = new ByteArrayOutputStream();
    try (var writer = BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getWriter(bytes)) {
      writer.write(clipboard);
    } catch (IOException e) {
      throw new UncheckedIOException("could not save shop schematic", e);
    }
    return bytes.toByteArray();
  }

  public static Clipboard decode(byte[] bytes) {
    try (var reader =
        BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getReader(new ByteArrayInputStream(bytes))) {
      return reader.read();
    } catch (IOException e) {
      throw new UncheckedIOException("could not read shop schematic", e);
    }
  }
}
