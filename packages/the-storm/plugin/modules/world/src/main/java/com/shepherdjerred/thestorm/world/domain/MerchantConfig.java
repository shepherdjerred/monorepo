package com.shepherdjerred.thestorm.world.domain;

import java.time.ZoneId;
import java.util.List;

/** An event-triggered, finite windmill trader visit in the main world. */
public record MerchantConfig(
    boolean enabled,
    String world,
    List<MerchantAnchor> anchors,
    int arrivalRadius,
    int visitMinutes,
    String timeZone) {

  public MerchantConfig {
    anchors = List.copyOf(anchors);
    if (!"world".equals(world)) {
      throw new IllegalArgumentException("the windmill merchant is restricted to the main world");
    }
    if (anchors.size() > 1 || (enabled && anchors.size() != 1)) {
      throw new IllegalArgumentException(
          "an enabled windmill merchant requires one measured anchor");
    }
    if (arrivalRadius < 4 || arrivalRadius > 32) {
      throw new IllegalArgumentException("merchant arrival radius must be 4-32 blocks");
    }
    if (visitMinutes < 5 || visitMinutes > 60) {
      throw new IllegalArgumentException("merchant visit length must be 5-60 minutes");
    }
    ZoneId.of(timeZone);
  }

  public ZoneId zone() {
    return ZoneId.of(timeZone);
  }

  public MerchantAnchor anchor() {
    if (!enabled) {
      throw new IllegalStateException("the disabled merchant has no active anchor");
    }
    return anchors.getFirst();
  }
}
