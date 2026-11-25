package com.shepherdjerred.thestorm.rwf.adapter.remote;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Evaluates the managed {@code the-storm-rwf-enabled} flag for one player without blocking Paper's
 * main thread. The identifier is checked against the shared flag inventory at build time.
 */
public final class FlagsRwfGate implements JoinGate, AutoCloseable {

  private static final String FLAG_KEY = "the-storm-rwf-enabled";

  private final FlagsClient client;
  private final String world;

  /**
   * @param base the Flags server address
   * @param deployment the Flags deployment ({@code <catalog>/<stage>})
   * @param world the rwf world, sent as evaluation context
   */
  public FlagsRwfGate(URI base, String deployment, String world) {
    this.client = new FlagsClient(base, deployment);
    this.world = world;
  }

  @Override
  public CompletableFuture<Boolean> allows(UUID player) {
    return client.evaluate(FLAG_KEY, Map.of("user", player.toString(), "world", world));
  }

  @Override
  public void close() {
    client.close();
  }
}
