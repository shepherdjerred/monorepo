package com.shepherdjerred.thestorm.rwf.domain.record;

import java.util.List;

/** The actor's permitted information, distinct from the privileged replay frames. */
public record ObservationFrame(long tick, String pseudonym, String contract, List<Double> values) {
  public ObservationFrame {
    values = List.copyOf(values);
    if (tick < 0
        || !RosterEntry.PSEUDONYM.matcher(pseudonym).matches()
        || !contract.matches("[a-z0-9-]{1,64}")
        || values.isEmpty()
        || values.size() > 256
        || values.stream().anyMatch(value -> !Double.isFinite(value))) {
      throw new IllegalArgumentException("invalid observation");
    }
  }
}
