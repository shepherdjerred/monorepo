package com.shepherdjerred.thestorm.essentials.app;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Durable staff state and append-only command audit. Writes and audit commit together. */
public interface StaffStore {
  record Entry(String kind, String id, String value) {}

  record Audit(String actor, String command, String targets, Instant at) {}

  CompletableFuture<List<Entry>> load();

  CompletableFuture<Void> write(List<Entry> entries, Audit audit);
}
