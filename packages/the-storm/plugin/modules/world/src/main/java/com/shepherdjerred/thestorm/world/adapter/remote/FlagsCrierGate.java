package com.shepherdjerred.thestorm.world.adapter.remote;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.world.app.CrierGate;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Evaluates the managed crier flag without blocking Paper's main thread. */
public final class FlagsCrierGate implements CrierGate, AutoCloseable {

  private static final String FLAG_KEY = "the-storm-crier-enabled";
  private final FlagsClient client;
  private final String flagKey;

  public FlagsCrierGate(URI base) {
    this(base, "minecraft/tsmc");
  }

  public FlagsCrierGate(URI base, String deployment) {
    this(base, deployment, FLAG_KEY);
  }

  FlagsCrierGate(URI base, String deployment, String flagKey) {
    this.client = new FlagsClient(base, deployment);
    this.flagKey = flagKey;
  }

  @Override
  public CompletableFuture<Boolean> enabled(UUID player) {
    return client.evaluate(flagKey, Map.of("user", player.toString(), "world", "world"));
  }

  @Override
  public void close() {
    client.close();
  }
}
