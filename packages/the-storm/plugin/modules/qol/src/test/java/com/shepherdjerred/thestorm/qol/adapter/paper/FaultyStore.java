package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
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
  public CompletableFuture<Claim> reserveTake(TakeRequest request) {
    return real.reserveTake(request);
  }

  @Override
  public CompletableFuture<Claim> reserveDrop(DropRequest request) {
    return real.reserveDrop(request);
  }

  @Override
  public CompletableFuture<List<Claim>> pendingClaims() {
    return real.pendingClaims();
  }

  @Override
  public CompletableFuture<Taken> finishTake(UUID token, UUID taker) {
    return real.finishTake(token, taker);
  }

  @Override
  public CompletableFuture<Void> releaseTake(UUID token, UUID taker) {
    return real.releaseTake(token, taker);
  }

  @Override
  public CompletableFuture<List<Drop>> beginExpiry(UUID grave, Notice notice) {
    return real.beginExpiry(grave, notice);
  }

  @Override
  public CompletableFuture<List<Drop>> beginOverflow(
      UUID grave, Set<Integer> indexes, GravePos at) {
    return real.beginOverflow(grave, indexes, at);
  }

  @Override
  public CompletableFuture<List<Drop>> pendingDrops() {
    return real.pendingDrops();
  }

  @Override
  public CompletableFuture<Void> deleteEmpty(UUID grave) {
    return real.deleteEmpty(grave);
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
  public CompletableFuture<List<PendingNotice>> listNotices(UUID player) {
    return real.listNotices(player);
  }

  @Override
  public CompletableFuture<Integer> acknowledgeNotices(UUID player, List<Long> ids) {
    return real.acknowledgeNotices(player, ids);
  }
}
