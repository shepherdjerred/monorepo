package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import java.time.Duration;
import java.util.List;

/** Repository-owned Stargate settings. */
public record StargateConfig(Duration openFor, List<ServerGate> serverGates) {
  public StargateConfig {
    serverGates = List.copyOf(serverGates);
    if (openFor.isNegative() || openFor.isZero() || openFor.compareTo(Duration.ofMinutes(2)) > 0) {
      throw new IllegalArgumentException(
          "Stargate openFor must be positive and at most two minutes");
    }
  }
}
