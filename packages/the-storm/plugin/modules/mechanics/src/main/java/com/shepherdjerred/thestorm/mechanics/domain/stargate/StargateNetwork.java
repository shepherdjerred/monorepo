package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import java.util.UUID;

/** A named network and its access policy. */
public record StargateNetwork(UUID id, String name, NetworkAccess access) {
  public StargateNetwork {
    name = Names.require(name);
  }
}
