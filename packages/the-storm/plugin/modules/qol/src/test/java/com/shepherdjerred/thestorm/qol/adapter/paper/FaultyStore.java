package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Real storage that tests can make fail: saving new graves, or reading them at start. */
final class FaultyStore implements GraveStore {

  private final GraveStore real;
  volatile boolean failCreate;
  volatile boolean failLoad;

  FaultyStore(GraveStore real) {
    this.real = real;
  }

  private static <T> CompletableFuture<T> broken() {
    return CompletableFuture.failedFuture(new IllegalStateException("disk full"));
  }

  @Override
  public CompletableFuture<List<GraveContents>> loadAll() {
    return failLoad ? broken() : real.loadAll();
  }

  @Override
  public CompletableFuture<Void> create(GraveContents grave) {
    return failCreate ? broken() : real.create(grave);
  }

  @Override
  public CompletableFuture<Taken> take(UUID grave, Set<Integer> indexes) {
    return real.take(grave, indexes);
  }

  @Override
  public CompletableFuture<Void> putBack(UUID grave, List<GraveItem> items) {
    return real.putBack(grave, items);
  }

  @Override
  public CompletableFuture<List<GraveItem>> delete(UUID grave) {
    return real.delete(grave);
  }

  @Override
  public CompletableFuture<List<GraveItem>> expire(UUID grave, Optional<Notice> notice) {
    return real.expire(grave, notice);
  }

  @Override
  public CompletableFuture<List<String>> takeNotices(UUID player) {
    return real.takeNotices(player);
  }
}
