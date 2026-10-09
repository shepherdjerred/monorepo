package com.shepherdjerred.thestorm.rwf.app.map;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import org.jspecify.annotations.Nullable;

/** Coordinates one active map and at most one prepared successor. Callbacks run on the owner. */
public final class MapRotation<T extends MapRotation.Entry> implements AutoCloseable {
  public interface Entry {
    String id();

    void prepare(Consumer<Boolean> done);

    void release();
  }

  private final List<T> maps;
  private final RandomGenerator random;
  private @Nullable T next;
  private CompletableFuture<Void> preparation = new CompletableFuture<>();
  private boolean ready;
  private boolean closed;
  private int generation;

  public MapRotation(List<T> maps, RandomGenerator random) {
    this.maps = List.copyOf(maps);
    this.random = random;
    if (maps.isEmpty() || maps.stream().map(Entry::id).distinct().count() != maps.size())
      throw new IllegalArgumentException("rotation needs distinct maps");
  }

  /** Begins the only successor preparation; the active map must already be ready. */
  public void prefetch(T active) {
    if (closed || next != null)
      throw new IllegalStateException("rotation is closed or already preparing a successor");
    var activeIndex = maps.indexOf(active);
    if (activeIndex < 0) throw new IllegalArgumentException("active map is outside rotation");
    var index = maps.size() == 1 ? activeIndex : random.nextInt(maps.size() - 1);
    if (maps.size() > 1 && index >= activeIndex) index++;
    var following = maps.get(index);
    next = following;
    ready = false;
    preparation = new CompletableFuture<>();
    var request = ++generation;
    if (following.id().equals(active.id())) complete(request, true);
    else following.prepare(ok -> complete(request, ok));
  }

  private void complete(int request, boolean ok) {
    if (request != generation) return;
    ready = ok;
    if (ok) preparation.complete(null);
    else
      preparation.completeExceptionally(new IllegalStateException("next map preparation failed"));
  }

  public void whenReady(Runnable done, Consumer<Throwable> failed) {
    if (closed) return;
    var request = generation;
    var _ =
        preparation.whenComplete(
            (_, failure) -> {
              if (request != generation) return;
              if (failure == null) done.run();
              else failed.accept(failure);
            });
  }

  /** Advances only after preparation succeeds, releasing the previous map's large resources. */
  public T take(T previous) {
    var following = next;
    if (closed || !ready || following == null)
      throw new IllegalStateException("following map is not ready");
    if (!previous.id().equals(following.id())) previous.release();
    next = null;
    ready = false;
    return following;
  }

  @Override
  public void close() {
    closed = true;
    generation++;
    preparation.cancel(false);
    next = null;
    ready = false;
  }
}
