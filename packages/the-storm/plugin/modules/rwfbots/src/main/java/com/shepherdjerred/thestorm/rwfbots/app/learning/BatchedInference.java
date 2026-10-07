package com.shepherdjerred.thestorm.rwfbots.app.learning;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ActionTicket;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CategoricalActions;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.LongSupplier;
import java.util.random.RandomGenerator;
import org.jspecify.annotations.Nullable;

/**
 * Main-thread state owner with at most one batched job in flight. Workers see immutable tensors,
 * never game objects. Busy ticks are skipped, not queued; the next observation gap resets memory.
 */
public final class BatchedInference implements AutoCloseable {
  private final RecurrentActor actor;
  private final ComputePool compute;
  private RandomGenerator random;
  private final LongSupplier clock;
  private final Map<UUID, Slot> slots = new HashMap<>();
  private @Nullable CompletableFuture<Completion> running;
  private long lastTick = -1;
  private boolean closed;
  private long submitted;
  private long skipped;
  private long timely;
  private long stale;
  private long expired;
  private long contextDrops;
  private long resets;
  private long rejected;
  private long hits;
  private long misses;
  private long maximumNanos;
  private long generation;
  private @Nullable CompletableFuture<Boolean> closing;

  public record Parts(
      RecurrentActor actor, ComputePool compute, RandomGenerator random, LongSupplier clock) {}

  public record Metrics(
      long submitted,
      long skipped,
      long timely,
      long stale,
      long expired,
      long contextDrops,
      long resets,
      long rejected,
      long hits,
      long misses,
      long maximumNanos) {}

  private static final class Slot {
    final InferenceRequest.Identity identity;
    final long generation;
    long memoryTick = -1;
    float[] hidden = new float[RecurrentActor.HIDDEN];
    float[] cell = new float[RecurrentActor.HIDDEN];
    Optional<ActionTicket> action = Optional.empty();

    Slot(InferenceRequest.Identity identity, long generation) {
      this.identity = identity;
      this.generation = generation;
    }
  }

  private record Pending(InferenceRequest request, long generation) {}

  private record Completion(List<Pending> requests, RecurrentActor.Output output, long nanos) {}

  private static final class Buffers {
    private final float[] observations;
    private final float[] hidden;
    private final float[] cell;

    Buffers(int rows) {
      observations = new float[rows * RecurrentActor.FEATURES];
      hidden = new float[rows * RecurrentActor.HIDDEN];
      cell = new float[rows * RecurrentActor.HIDDEN];
    }
  }

  public BatchedInference(Parts parts) {
    actor = parts.actor();
    compute = parts.compute();
    random = parts.random();
    clock = parts.clock();
  }

  /** Exactly once per world tick, with every currently living body that has a fair observation. */
  public void tick(long tick, List<InferenceRequest> requests) {
    if (closed) throw new IllegalStateException("inference owner is closed");
    validateTick(tick, requests);
    lastTick = tick;
    var identities = requests.stream().map(request -> request.identity().body()).toList();
    slots.keySet().removeIf(body -> !identities.contains(body));
    for (var request : requests) {
      identify(request);
    }
    drain(tick);
    if (requests.isEmpty()) return;
    if (running != null) {
      skipped += requests.size();
      return;
    }
    start(List.copyOf(requests));
  }

  private Slot identify(InferenceRequest request) {
    var old = slots.get(request.identity().body());
    if (old != null && old.identity.equals(request.identity())) return old;
    var slot = new Slot(request.identity(), ++generation);
    slots.put(request.identity().body(), slot);
    resets++;
    return slot;
  }

  private void validateTick(long tick, List<InferenceRequest> requests) {
    if (tick <= lastTick || requests.size() > 100)
      throw new IllegalArgumentException("nonmonotonic or oversized inference tick");
    if (requests.stream().anyMatch(request -> request.tick() != tick)
        || requests.stream().map(request -> request.identity().body()).distinct().count()
            != requests.size())
      throw new IllegalArgumentException("mixed or duplicate inference contexts");
  }

  private void drain(long tick) {
    var job = running;
    if (job == null || !job.isDone()) return;
    // getNow never waits. Exceptional completion is an internal/model failure,
    // not an expected latency timeout, and deliberately propagates loudly.
    var completion = job.getNow(null);
    running = null;
    if (completion == null) throw new IllegalStateException("missing completed inference");
    maximumNanos = Math.max(maximumNanos, completion.nanos());
    if (completion.output().logits().rows() != completion.requests().size())
      throw new IllegalStateException("inference batch rows changed");
    for (var index = 0; index < completion.requests().size(); index++)
      commit(completion, index, tick);
  }

  private void commit(Completion completion, int index, long tick) {
    var pending = completion.requests().get(index);
    var request = pending.request();
    var slot = slots.get(request.identity().body());
    if (slot == null
        || slot.generation != pending.generation()
        || !slot.identity.equals(request.identity())) {
      contextDrops++;
      stale++;
      return;
    }
    if (tick - request.tick() > 2) {
      expired++;
      stale++;
      return;
    }
    slot.hidden = completion.output().hidden().row(index);
    slot.cell = completion.output().cell().row(index);
    slot.memoryTick = request.tick();
    slot.action =
        Optional.of(
            request.ticket(
                CategoricalActions.sample(completion.output().logits().row(index), random)));
    timely++;
  }

  private void start(List<InferenceRequest> requests) {
    var rows = requests.size();
    var buffers = new Buffers(rows);
    for (var index = 0; index < rows; index++) fill(requests.get(index), index, buffers);
    var input =
        new RecurrentActor.Input(
            new ActorMatrix(rows, RecurrentActor.FEATURES, buffers.observations),
            new ActorMatrix(rows, RecurrentActor.HIDDEN, buffers.hidden),
            new ActorMatrix(rows, RecurrentActor.HIDDEN, buffers.cell));
    var pending =
        requests.stream()
            .map(request -> new Pending(request, identify(request).generation))
            .toList();
    try {
      running =
          compute.submit(
              () -> {
                var began = clock.getAsLong();
                var output = actor.forward(input);
                return new Completion(pending, output, clock.getAsLong() - began);
              });
      submitted += rows;
    } catch (RejectedExecutionException failure) {
      rejected += rows;
    }
  }

  private void fill(InferenceRequest request, int index, Buffers buffers) {
    var slot = slots.get(request.identity().body());
    if (slot == null) throw new IllegalStateException("missing inference slot");
    for (var column = 0; column < RecurrentActor.FEATURES; column++)
      buffers.observations[index * RecurrentActor.FEATURES + column] =
          request.observation().get(column).floatValue();
    if (slot.memoryTick >= 0 && request.tick() - slot.memoryTick == 1) {
      System.arraycopy(
          slot.hidden, 0, buffers.hidden, index * RecurrentActor.HIDDEN, RecurrentActor.HIDDEN);
      System.arraycopy(
          slot.cell, 0, buffers.cell, index * RecurrentActor.HIDDEN, RecurrentActor.HIDDEN);
    } else if (slot.memoryTick >= 0) {
      resets++;
    }
  }

  public Optional<ActionTicket> action(InferenceRequest current) {
    if (closed) throw new IllegalStateException("inference owner is closed");
    if (current.tick() < lastTick)
      throw new IllegalArgumentException("old inference action context");
    identify(current);
    drain(current.tick());
    var slot = slots.get(current.identity().body());
    var action =
        slot == null || !slot.identity.equals(current.identity())
            ? Optional.<ActionTicket>empty()
            : slot.action;
    var valid =
        action.filter(
            ticket ->
                ticket.applies(
                    current.identity().match(),
                    current.identity().body(),
                    current.identity().life(),
                    current.tick()));
    if (valid.isPresent()) hits++;
    else misses++;
    return valid;
  }

  public Metrics metrics() {
    return new Metrics(
        submitted,
        skipped,
        timely,
        stale,
        expired,
        contextDrops,
        resets,
        rejected,
        hits,
        misses,
        maximumNanos);
  }

  /** Drop a finished match's recurrent state and use its successor's injected randomness. */
  public void reset(RandomGenerator matchRandom) {
    if (closed) throw new IllegalStateException("inference owner is closed");
    slots.clear();
    random = matchRandom;
  }

  /** Native session closure runs after the last job, off the main thread. */
  @Override
  public void close() {
    if (closed) return;
    closed = true;
    slots.clear();
    var job = running;
    // Queue the cleanup registration before core shuts its executor down. If the
    // inference is still running, its completing worker closes the native actor;
    // no later executor submission is needed during shutdown.
    var terminal = new CompletableFuture<Boolean>();
    closing = terminal;
    compute.executor().execute(() -> closeAfter(job, terminal));
  }

  private void closeAfter(
      @Nullable CompletableFuture<Completion> job, CompletableFuture<Boolean> terminal) {
    if (job == null) {
      finishClose(terminal);
    } else {
      var _ = job.whenComplete((completion, failure) -> finishClose(terminal));
    }
  }

  private void finishClose(CompletableFuture<Boolean> terminal) {
    try {
      actor.close();
      terminal.complete(true);
    } catch (RuntimeException failure) {
      terminal.completeExceptionally(failure);
      throw failure;
    }
  }

  public Optional<CompletableFuture<Boolean>> closing() {
    return Optional.ofNullable(closing);
  }
}
