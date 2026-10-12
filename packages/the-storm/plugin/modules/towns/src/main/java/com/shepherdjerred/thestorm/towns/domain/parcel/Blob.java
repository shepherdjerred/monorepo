package com.shepherdjerred.thestorm.towns.domain.parcel;

import java.util.Arrays;

/** Detached, immutable bytes belonging to a durable build journal. */
public final class Blob {
  private final byte[] bytes;

  public Blob(byte[] bytes) {
    if (bytes.length > 134_217_728) {
      throw new IllegalArgumentException("shop archive exceeds 128 MiB");
    }
    this.bytes = bytes.clone();
  }

  public byte[] bytes() {
    return bytes.clone();
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof Blob blob && Arrays.equals(bytes, blob.bytes);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(bytes);
  }
}
