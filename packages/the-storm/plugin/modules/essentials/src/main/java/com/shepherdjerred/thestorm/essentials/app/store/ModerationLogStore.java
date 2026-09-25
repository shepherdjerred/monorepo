package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** The append-only moderation audit log. */
public interface ModerationLogStore {

  /** Appends {@code entry}. */
  CompletableFuture<Void> append(AuditEntry entry);

  /** Every entry, oldest first, for rebuilding standings at startup. */
  CompletableFuture<List<AuditEntry>> all();

  /** {@code target}'s newest {@code limit} entries, newest first. */
  CompletableFuture<List<AuditEntry>> history(UUID target, int limit);
}
