package com.shepherdjerred.thestorm.mail.app;

import java.util.Arrays;

/** Opaque serialized item stack; Paper metadata and nested containers remain intact. */
public final class MailItem {
  private final byte[] bytes;

  public MailItem(byte[] bytes) {
    if (bytes.length == 0 || bytes.length > 1_048_576) {
      throw new IllegalArgumentException("invalid mailed item size");
    }
    this.bytes = bytes.clone();
  }

  public byte[] bytes() {
    return bytes.clone();
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof MailItem item && Arrays.equals(bytes, item.bytes);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(bytes);
  }
}
