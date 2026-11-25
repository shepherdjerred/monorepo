package com.shepherdjerred.thestorm.rwfbots.adapter.remote;

import com.shepherdjerred.thestorm.core.expansion.FlagProviderUnavailableException;
import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.rwfbots.app.learning.LearningGate;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * The managed match-scoped flag. Successful invalid values and missing declared flags are errors.
 */
public final class FlagsLearningGate implements LearningGate {
  private static final String FLAG_KEY = "the-storm-rwfbots-learning-enabled";
  private final FlagsClient client;

  public FlagsLearningGate(URI base, String deployment) {
    this.client = new FlagsClient(base, deployment);
  }

  @Override
  public CompletableFuture<Decision> evaluate(Context context) {
    var evaluationContext = new LinkedHashMap<String, String>(3);
    evaluationContext.put("match", context.match().toString());
    evaluationContext.put("map", context.map());
    evaluationContext.put("world", context.world());
    return client
        .evaluate(FLAG_KEY, evaluationContext)
        .thenApply(enabled -> new Decision(enabled, Source.FLAGS))
        .exceptionally(failure -> {
          var cause = FlagProviderUnavailableException.unwrap(failure);
          if (cause instanceof FlagProviderUnavailableException) {
            return new Decision(false, Source.UNAVAILABLE);
          }
          throw new CompletionException(cause);
        });
  }

  @Override
  public void close() {
    client.close();
  }
}
