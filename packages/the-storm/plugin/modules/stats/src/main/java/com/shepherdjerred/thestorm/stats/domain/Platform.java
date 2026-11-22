package com.shepherdjerred.thestorm.stats.domain;

import java.util.Locale;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** Client edition platform reported in session ingest events. */
public enum Platform {
  JAVA("java"),
  BEDROCK("bedrock");

  private final String wire;

  Platform(String wire) {
    this.wire = wire;
  }

  public String wire() {
    return wire;
  }

  /**
   * Detects Bedrock players via Floodgate's XUID UUID prefix ({@code 00000000-0000-0000-...}) or
   * Geyser client brand.
   */
  public static Platform detect(UUID playerUuid, @Nullable String clientBrand) {
    if (playerUuid.getMostSignificantBits() == 0L) {
      return BEDROCK;
    }
    if (clientBrand != null && clientBrand.toLowerCase(Locale.ROOT).contains("geyser")) {
      return BEDROCK;
    }
    return JAVA;
  }
}
