package com.shepherdjerred.thestorm.essentials.domain.home;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.UUID;

/** A saved destination from one specific historical archive. */
public record HistoricalHome(UUID player, String archive, Position position) {
  public HistoricalHome {
    if (archive.isBlank()) throw new IllegalArgumentException("archive must not be blank");
    if (position.yaw() != 0 || position.pitch() != 0) {
      throw new IllegalArgumentException("historical spawn has no recorded facing");
    }
  }
}
