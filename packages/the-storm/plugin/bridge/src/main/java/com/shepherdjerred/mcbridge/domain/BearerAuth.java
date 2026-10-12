package com.shepherdjerred.mcbridge.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.jspecify.annotations.Nullable;

/** Checks {@code Authorization: Bearer <token>} in constant time. */
public final class BearerAuth {
  private static final String PREFIX = "Bearer ";

  private final byte[] expected;

  public BearerAuth(String token) {
    this.expected = token.getBytes(StandardCharsets.UTF_8);
  }

  /** True only for an exact {@code Bearer <token>} header. */
  public boolean accepts(@Nullable String header) {
    if (header == null || !header.startsWith(PREFIX)) {
      return false;
    }
    byte[] presented = header.substring(PREFIX.length()).getBytes(StandardCharsets.UTF_8);
    return MessageDigest.isEqual(expected, presented);
  }
}
