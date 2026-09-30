package com.shepherdjerred.thestorm.qol.domain.grave;

import java.util.Arrays;
import java.util.HexFormat;
import org.jspecify.annotations.Nullable;

/** One serialized item stack. Immutable: the bytes are copied in and out. */
public final class ItemBytes {

  private final byte[] bytes;

  private ItemBytes(byte[] bytes) {
    this.bytes = bytes;
  }

  public static ItemBytes of(byte[] bytes) {
    if (bytes.length == 0) {
      throw new IllegalArgumentException("an item is never zero bytes");
    }
    return new ItemBytes(bytes.clone());
  }

  /** A copy of the bytes. */
  public byte[] bytes() {
    return bytes.clone();
  }

  @Override
  public boolean equals(@Nullable Object other) {
    return other instanceof ItemBytes that && Arrays.equals(bytes, that.bytes);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(bytes);
  }

  @Override
  public String toString() {
    var shown = Math.min(bytes.length, 8);
    return "ItemBytes["
        + HexFormat.of().formatHex(bytes, 0, shown)
        + (shown < bytes.length ? "..." : "")
        + ", "
        + bytes.length
        + " bytes]";
  }
}
