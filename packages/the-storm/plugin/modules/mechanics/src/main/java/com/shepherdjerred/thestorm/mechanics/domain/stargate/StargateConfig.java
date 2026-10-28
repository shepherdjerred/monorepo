package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import java.time.Duration;
import java.util.List;

/** Repository-owned Stargate settings. */
public record StargateConfig(Duration openFor, List<ServerGate> serverGates) {
  public StargateConfig {
    serverGates = List.copyOf(serverGates);
    var ids = new java.util.HashSet<String>();
    for (var gate : serverGates) {
      if (!ids.add(gate.id()))
        throw new IllegalArgumentException("duplicate server Stargate id: " + gate.id());
    }
    if (openFor.isNegative() || openFor.isZero() || openFor.compareTo(Duration.ofMinutes(2)) > 0) {
      throw new IllegalArgumentException(
          "Stargate openFor must be positive and at most two minutes");
    }
  }
}
