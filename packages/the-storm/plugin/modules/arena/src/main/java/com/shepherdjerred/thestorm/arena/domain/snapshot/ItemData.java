package com.shepherdjerred.thestorm.arena.domain.snapshot;

import java.util.Arrays;
import java.util.HexFormat;

/**
 * Serialized items, opaque to the domain: Paper writes and reads the bytes. Immutable; the bytes
 * are copied in and out.
 */
public final class ItemData {

  private final byte[] bytes;

  private ItemData(byte[] bytes) {
    this.bytes = bytes.clone();
  }

  public static ItemData of(byte[] bytes) {
    return new ItemData(bytes);
  }

  /** A copy of the bytes. */
  public byte[] bytes() {
    return bytes.clone();
  }

  public int size() {
    return bytes.length;
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof ItemData data && Arrays.equals(bytes, data.bytes);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(bytes);
  }

  @Override
  public String toString() {
    var head = HexFormat.of().formatHex(bytes, 0, Math.min(bytes.length, 8));
    return "ItemData[" + bytes.length + " bytes, " + head + "...]";
  }
}
