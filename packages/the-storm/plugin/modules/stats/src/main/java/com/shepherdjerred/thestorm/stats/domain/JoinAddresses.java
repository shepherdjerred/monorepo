package com.shepherdjerred.thestorm.stats.domain;

import java.util.Locale;
import org.jspecify.annotations.Nullable;

/** Normalizes handshake hostnames, stripping port numbers and Forge/FML null-byte suffixes. */
public final class JoinAddresses {

  private static final int MAX_LENGTH = 255;

  private JoinAddresses() {}

  public static @Nullable String normalize(@Nullable String rawHostname) {
    if (rawHostname == null) {
      return null;
    }
    var trimmed = rawHostname.strip();
    var nullIdx = trimmed.indexOf('\0');
    if (nullIdx >= 0) {
      trimmed = trimmed.substring(0, nullIdx).strip();
    }
    trimmed = stripPort(trimmed);
    while (trimmed.endsWith(".")) {
      trimmed = trimmed.substring(0, trimmed.length() - 1);
    }
    trimmed = trimmed.strip().toLowerCase(Locale.ROOT);
    if (trimmed.isEmpty()) {
      return null;
    }
    return trimmed.length() > MAX_LENGTH ? trimmed.substring(0, MAX_LENGTH) : trimmed;
  }

  private static String stripPort(String host) {
    if (host.startsWith("[")) {
      var closeIdx = host.indexOf(']');
      if (closeIdx > 1) {
        return host.substring(1, closeIdx);
      }
    }
    var firstColon = host.indexOf(':');
    if (firstColon > 0 && host.indexOf(':', firstColon + 1) < 0) {
      return host.substring(0, firstColon);
    }
    return host;
  }
}
