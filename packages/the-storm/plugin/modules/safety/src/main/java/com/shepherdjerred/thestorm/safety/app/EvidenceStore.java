package com.shepherdjerred.thestorm.safety.app;

import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Append-only evidence. No delete, retention or update operation is exposed. */
public interface EvidenceStore {
  record Entry(ContentSubmission submission, Instant at) {}

  record Observation(ContentSubmission submission, String outcome, Instant at) {}

  CompletableFuture<Void> observations(List<Observation> observations);

  CompletableFuture<Void> attempt(ContentSubmission submission, Instant at);

  CompletableFuture<Void> event(UUID submission, String outcome, String details, Instant at);

  CompletableFuture<List<Entry>> recent(UUID player, Instant since, int limit);

  CompletableFuture<String> search(String player, String text, int limit);

  CompletableFuture<Integer> strikes(UUID player, String outcome, Instant since);

  CompletableFuture<Integer> advertisingWarnings(UUID player, Instant since, Instant before);

  CompletableFuture<List<Entry>> context(String audience, Instant since, int limit);
}
