package com.shepherdjerred.thestorm.npcs.domain.npc;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** The poses a Mannequin can hold. */
public enum NpcPose {
  STANDING,
  SNEAKING,
  SLEEPING,
  SWIMMING,
  FALL_FLYING;

  /** The content spelling, such as {@code fall_flying}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  public static Optional<NpcPose> byId(String id) {
    return Arrays.stream(values()).filter(pose -> pose.id().equals(id)).findFirst();
  }
}
