package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.app.learning.AcceptedInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.RecurrentActor;
import java.nio.file.Path;
import java.util.SplittableRandom;
import java.util.concurrent.CompletableFuture;
import java.util.function.LongSupplier;
import java.util.random.RandomGenerator;
import org.jspecify.annotations.Nullable;

/** One accepted session per module; no file I/O, native warmup or closure blocks Paper. */
public final class AcceptedModels implements AcceptedInference, AutoCloseable {
  public record Parts(
      Path directory, ComputePool compute, RandomGenerator random, LongSupplier clock) {}

  private final Parts parts;
  private @Nullable CompletableFuture<BatchedInference> loading;
  private @Nullable BatchedInference owned;
  private boolean closed;

  public AcceptedModels(Parts parts) {
    this.parts = parts;
  }

  @Override
  public synchronized CompletableFuture<BatchedInference> load() {
    if (closed) throw new IllegalStateException("accepted model owner closed");
    var existing = loading;
    if (existing != null) return existing;
    var seed = parts.random().nextLong();
    var submitted =
        parts
            .compute()
            .submit(
                () -> {
                  var actor = OnnxActor.load(parts.directory(), ActorManifest.Acceptance.ACCEPTED);
                  try {
                    ActorWarmup.run(actor);
                    return own(actor, seed);
                  } catch (RuntimeException failure) {
                    actor.close();
                    throw failure;
                  }
                });
    loading = submitted;
    return submitted;
  }

  private synchronized BatchedInference own(RecurrentActor actor, long seed) {
    if (closed) throw new IllegalStateException("accepted owner closed during loading");
    var model =
        new BatchedInference(
            new BatchedInference.Parts(
                actor, parts.compute(), new SplittableRandom(seed), parts.clock()));
    owned = model;
    return model;
  }

  @Override
  public synchronized void close() {
    if (closed) return;
    closed = true;
    var model = owned;
    if (model != null) model.close();
    owned = null;
  }
}
