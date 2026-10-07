package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.app.learning.ActorMatrix;
import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.DiagnosticInference;
import com.shepherdjerred.thestorm.rwfbots.app.learning.RecurrentActor;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import java.util.concurrent.CompletableFuture;
import java.util.function.LongSupplier;
import java.util.random.RandomGenerator;

/** Owned diagnostic actors, loaded and warmed on core's compute pool, closed on module shutdown. */
public final class DiagnosticModels implements DiagnosticInference, AutoCloseable {
  public record Parts(
      Path directory, ComputePool compute, RandomGenerator random, LongSupplier clock) {}

  private final Parts parts;
  private final List<BatchedInference> loaded = new ArrayList<>();
  private boolean closed;

  public DiagnosticModels(Parts parts) {
    this.parts = parts;
  }

  @Override
  public synchronized CompletableFuture<BatchedInference> load() {
    if (closed) throw new IllegalStateException("diagnostic model owner closed");
    var seed = parts.random().nextLong();
    return parts
        .compute()
        .submit(
            () -> {
              var actor =
                  OnnxActor.load(parts.directory(), ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC);
              try {
                warm(actor);
                return own(actor, seed);
              } catch (RuntimeException failure) {
                actor.close();
                throw failure;
              }
            });
  }

  private synchronized BatchedInference own(RecurrentActor actor, long seed) {
    if (closed) throw new IllegalStateException("diagnostic model owner closed during loading");
    var engine =
        new BatchedInference(
            new BatchedInference.Parts(
                actor, parts.compute(), new SplittableRandom(seed), parts.clock()));
    loaded.add(engine);
    return engine;
  }

  private static void warm(RecurrentActor actor) {
    for (var rows : List.of(1, 3, 20, 100)) {
      var observation = new ActorMatrix(rows, 34, new float[rows * 34]);
      var hidden = new ActorMatrix(rows, 128, new float[rows * 128]);
      var cell = new ActorMatrix(rows, 128, new float[rows * 128]);
      for (var step = 0; step < 4; step++) {
        var output = actor.forward(new RecurrentActor.Input(observation, hidden, cell));
        hidden = output.hidden();
        cell = output.cell();
      }
    }
  }

  @Override
  public synchronized void close() {
    if (closed) return;
    closed = true;
    loaded.forEach(BatchedInference::close);
    loaded.clear();
  }
}
