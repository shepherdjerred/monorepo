package com.shepherdjerred.thestorm.rwfbots.app.learning;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** One managed evaluation per ordinary match; only transport absence may use the off default. */
public interface LearningGate extends AutoCloseable {
  record Context(UUID match, String map, String world, long seed) {
    public Context {
      if (map.isBlank() || world.isBlank())
        throw new IllegalArgumentException("empty match context");
    }
  }

  enum Source {
    FLIPT,
    ABSENT,
    UNAVAILABLE
  }

  record Decision(boolean enabled, Source source) {
    public Decision {
      if (enabled && source != Source.FLIPT)
        throw new IllegalArgumentException("default learning decision must be off");
    }
  }

  CompletableFuture<Decision> evaluate(Context context);

  @Override
  void close();

  static LearningGate absent() {
    return new LearningGate() {
      @Override
      public CompletableFuture<Decision> evaluate(Context context) {
        return CompletableFuture.completedFuture(new Decision(false, Source.ABSENT));
      }

      @Override
      public void close() {}
    };
  }
}
