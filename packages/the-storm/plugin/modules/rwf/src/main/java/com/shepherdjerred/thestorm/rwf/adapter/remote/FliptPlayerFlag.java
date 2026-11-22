package com.shepherdjerred.thestorm.rwf.adapter.remote;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import java.net.URI;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * One managed boolean flag evaluated per player without blocking Paper's main thread, with the rwf
 * world as evaluation context. Each flag's identifier lives in its own class ({@link
 * FliptRwfKitsGate}, {@link FliptRwfKillstreaksGate}), checked against the shared flag inventory at
 * build time.
 */
public final class FliptPlayerFlag implements JoinGate, AutoCloseable {

  private final FlagsClient client;
  private final String world;
  private final String flag;

  FliptPlayerFlag(URI base, String deployment, String world, String flag) {
    this.client = new FlagsClient(base, deployment);
    this.world = world;
    this.flag = flag;
  }

  /** The flag key, for logs. */
  public String flag() {
    return flag;
  }

  @Override
  public CompletableFuture<Boolean> allows(UUID player) {
    return client.evaluate(flag, Map.of("user", player.toString(), "world", world));
  }

  @Override
  public void close() {
    client.close();
  }
}
