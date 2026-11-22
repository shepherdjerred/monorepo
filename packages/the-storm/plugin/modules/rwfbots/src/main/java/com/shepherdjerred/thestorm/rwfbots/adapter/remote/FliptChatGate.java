package com.shepherdjerred.thestorm.rwfbots.adapter.remote;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.rwfbots.app.ChatGate;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Evaluates the managed {@code the-storm-rwfbots-chat-enabled} flag without blocking Paper's main
 * thread. The flag is server-wide, evaluated with the rwf world as context. The identifier is
 * checked against the shared flag inventory at build time.
 */
public final class FliptChatGate implements ChatGate {

  private static final String FLAG_KEY = "the-storm-rwfbots-chat-enabled";

  private final FlagsClient client;
  private final String world;

  /**
   * @param base the Flags server address
   * @param deployment the Flags deployment ({@code <catalog>/<stage>})
   * @param world the rwf world, sent as evaluation context
   */
  public FliptChatGate(URI base, String deployment, String world) {
    this.client = new FlagsClient(base, deployment);
    this.world = world;
  }

  @Override
  public CompletableFuture<Boolean> enabled() {
    return client.evaluate(FLAG_KEY, Map.of("world", world));
  }

  @Override
  public void close() {
    client.close();
  }
}
