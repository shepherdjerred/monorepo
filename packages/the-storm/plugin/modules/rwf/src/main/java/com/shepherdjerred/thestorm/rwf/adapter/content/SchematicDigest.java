package com.shepherdjerred.thestorm.rwf.adapter.content;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/** The unchanged canonical schematic fingerprint, streamed without a full terrain-sized buffer. */
public final class SchematicDigest {
  private static final int BUFFER_BYTES = 8192;
  private final MessageDigest digest = sha256();
  private final ByteBuffer buffer = ByteBuffer.allocate(BUFFER_BYTES);
  private final long expected;
  private long written;
  private boolean finished;

  public SchematicDigest(Schematic.Dimensions size, List<String> palette) {
    expected = size.blocks();
    digest.update(
        ("sponge-v3\n" + size.width() + " " + size.height() + " " + size.length() + "\n")
            .getBytes(StandardCharsets.UTF_8));
    for (var i = 0; i < palette.size(); i++)
      digest.update((i + "\t" + palette.get(i) + "\n").getBytes(StandardCharsets.UTF_8));
  }

  /** Adds the next palette index in y, z, x order using the original big-endian int encoding. */
  public void add(int index) {
    if (finished || written == expected)
      throw new IllegalStateException("schematic digest has no remaining blocks");
    buffer.putInt(index);
    written++;
    if (!buffer.hasRemaining()) flush();
  }

  public String finish() {
    if (finished) throw new IllegalStateException("schematic digest is already finished");
    if (written != expected)
      throw new IllegalStateException("expected " + expected + " blocks, got " + written);
    flush();
    finished = true;
    return HexFormat.of().formatHex(digest.digest());
  }

  private void flush() {
    digest.update(buffer.array(), 0, buffer.position());
    buffer.clear();
  }

  private static MessageDigest sha256() {
    try {
      return MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA-256 is required by Java", impossible);
    }
  }
}
