package com.shepherdjerred.thestorm.towns.domain.parcel;

import java.util.Set;

/** Language-neutral RCON contract, validated by both the plugin and Temporal Activity. */
public record PlotProtocol(int version, String prefix, Set<String> states) {
  public PlotProtocol {
    states = Set.copyOf(states);
    if (version != 1
        || !prefix.equals("PLOT_RECONCILE")
        || !states.equals(Set.of("RUNNING", "COMPLETE", "BUSY", "FAILED", "UNKNOWN"))) {
      throw new IllegalArgumentException("unsupported plot reconciliation protocol");
    }
  }
}
