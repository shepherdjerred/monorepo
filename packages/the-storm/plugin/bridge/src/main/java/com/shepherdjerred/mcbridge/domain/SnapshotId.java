package com.shepherdjerred.mcbridge.domain;

import java.time.Instant;
import java.util.HexFormat;
import java.util.random.RandomGenerator;
import java.util.regex.Pattern;

/** A snapshot id: {@code snap-<epoch millis base36>-<6 hex>}, safe as a file name. */
public record SnapshotId(String value) {
  private static final Pattern VALID = Pattern.compile("[a-z0-9-]{1,64}");

  public SnapshotId {
    if (!VALID.matcher(value).matches()) {
      throw new BridgeException(ErrorCode.NOT_FOUND, "no snapshot " + value);
    }
  }

  /** A fresh id from the current time and three random bytes. */
  public static SnapshotId next(Instant now, RandomGenerator random) {
    byte[] suffix = new byte[3];
    random.nextBytes(suffix);
    return new SnapshotId(
        "snap-" + Long.toString(now.toEpochMilli(), 36) + "-" + HexFormat.of().formatHex(suffix));
  }
}
