package com.shepherdjerred.thestorm.mechanics.adapter.remote;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** Resolves the server-scoped Stargate rollout asynchronously at startup. */
public final class FlagsStargatesGate implements AutoCloseable {
  private static final String FLAG_KEY = "the-storm-stargates-enabled";
  private final FlagsClient client;

  public FlagsStargatesGate(URI base, String deployment) {
    this.client = new FlagsClient(base, deployment);
  }

  public CompletableFuture<Boolean> enabled() {
    return client.evaluate(FLAG_KEY, Map.of("server", "the-storm-server"));
  }

  @Override
  public void close() {
    client.close();
  }
}
