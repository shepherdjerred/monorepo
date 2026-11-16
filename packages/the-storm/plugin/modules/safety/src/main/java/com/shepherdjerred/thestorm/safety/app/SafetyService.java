package com.shepherdjerred.thestorm.safety.app;

import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.domain.ContentRules;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;
import tools.jackson.databind.json.JsonMapper;

/** Per-author FIFO admission, durable attempts and limited, auditable penalties. */
public final class SafetyService implements ContentSafety {
  private static final Duration DAY = Duration.ofDays(1);
  private static final Duration WEEK = Duration.ofDays(7);
  private static final Duration RECENT_WINDOW = Duration.ofSeconds(20);
  private static final int MAX_RECENT_PER_PLAYER = 64;
  private static final int MAX_RECENT_PLAYERS = 512;
  private static final JsonMapper JSON = JsonMapper.builder().build();

  private static final class Queue {
    private CompletableFuture<Void> tail = CompletableFuture.completedFuture(null);
    private int pending;
    private final Set<UUID> waiting = ConcurrentHashMap.newKeySet();
  }

  private record WindowEntry(String audience, String text, Instant at) {}

  private final ConcurrentHashMap<UUID, Queue> queues = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<UUID, ArrayDeque<WindowEntry>> recentWindows =
      new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Function<UUID, String>> evidenceContexts =
      new ConcurrentHashMap<>();
  private final List<Consumer<UUID>> retractionHandlers = new CopyOnWriteArrayList<>();
  private final EvidenceStore store;
  private final ContentClassifier classifier;
  private final InstantSource time;
  private final SafetyConfig config;
  private final Function<UUID, CompletableFuture<Boolean>> enabled;
  private Function<com.shepherdjerred.thestorm.core.safety.ContentPenalty, CompletableFuture<Void>>
      penalty =
          request ->
              CompletableFuture.failedFuture(
                  new IllegalStateException("Safety penalty owner is unavailable"));
  private BiFunction<ContentSubmission, ContentReview, CompletableFuture<Void>> reviews =
      (submission, review) -> CompletableFuture.completedFuture(null);
  private BiFunction<UUID, String, String> routes = (player, original) -> original;
  private BiFunction<UUID, String, String> audiences = (player, text) -> "player:" + player;
  private Function<UUID, CompletableFuture<Boolean>> muted =
      player -> CompletableFuture.completedFuture(false);

  public record Policy(
      InstantSource time,
      SafetyConfig config,
      Function<UUID, CompletableFuture<Boolean>> enabled) {}

  public SafetyService(EvidenceStore store, ContentClassifier classifier, Policy policy) {
    this.store = store;
    this.classifier = classifier;
    this.time = policy.time();
    this.config = policy.config();
    this.enabled = policy.enabled();
  }

  @Override
  public void penalties(
      Function<com.shepherdjerred.thestorm.core.safety.ContentPenalty, CompletableFuture<Void>>
          handler) {
    penalty = handler;
  }

  @Override
  public void reviews(
      BiFunction<ContentSubmission, ContentReview, CompletableFuture<Void>> handler) {
    reviews = handler;
  }

  @Override
  public void commandRoutes(BiFunction<UUID, String, String> handler) {
    routes = handler;
  }

  @Override
  public String command(UUID player, String original) {
    return routes.apply(player, original);
  }

  @Override
  public void audiences(BiFunction<UUID, String, String> provider) {
    audiences = provider;
  }

  @Override
  public String audience(UUID player, String text) {
    return audiences.apply(player, text);
  }

  @Override
  public void mutes(Function<UUID, CompletableFuture<Boolean>> predicate) {
    muted = predicate;
  }

  @Override
  public void retractions(Consumer<UUID> handler) {
    retractionHandlers.add(handler);
  }

  @Override
  public void retract(UUID submission) {
    for (var handler : retractionHandlers) {
      handler.accept(submission);
    }
  }

  /** Completes once all currently queued per-player screening tasks finish. */
  public CompletableFuture<Void> awaitPending() {
    var tails =
        queues.values().stream()
            .map(queue -> {
              synchronized (queue) {
                return queue.tail;
              }
            })
            .toArray(CompletableFuture[]::new);
    return CompletableFuture.allOf(tails);
  }

  @Override
  public void evidenceContext(String key, Function<UUID, String> provider) {
    if (evidenceContexts.putIfAbsent(key, provider) != null)
      throw new IllegalStateException("Duplicate evidence context provider: " + key);
  }

  @Override
  public java.util.Map<String, String> evidenceContext(UUID player) {
    var result = new java.util.TreeMap<String, String>();
    evidenceContexts.forEach((key, provider) -> result.put(key, provider.apply(player)));
    return java.util.Map.copyOf(result);
  }

  /** Evaluates synchronous Stage-1 rules against the bounded 20-second in-memory chat window. */
  public Optional<ContentRules.InstantBlock> instantBlock(ContentSubmission submission) {
    return instantBlock(submission, true);
  }

  /** Evaluates synchronous Stage-1 rules; credential redaction runs even when screening is off. */
  public Optional<ContentRules.InstantBlock> instantBlock(
      ContentSubmission submission, boolean contentSafetyEnabled) {
    if (!contentSafetyEnabled) {
      return ContentRules.instantBlock(
          submission.text(), submission.name(), ContentRules.RecentWindow.EMPTY, true);
    }
    var staffEvidence =
        Set.of("ticket", "command", "command-content").contains(submission.surface());
    var window = snapshotWindow(submission.player(), submission.audience());
    return ContentRules.instantBlock(submission.text(), submission.name(), window, staffEvidence);
  }

  /** Records a delivered live chat or message submission in the 20-second in-memory window. */
  public void recordRecentWindow(ContentSubmission submission) {
    if (!Set.of("chat", "message").contains(submission.surface())) return;
    var now = time.instant();
    var cutoff = now.minus(RECENT_WINDOW);
    var entries = recentWindows.computeIfAbsent(submission.player(), ignored -> new ArrayDeque<>());
    synchronized (entries) {
      pruneExpired(entries, cutoff);
      while (entries.size() >= MAX_RECENT_PER_PLAYER) {
        entries.removeFirst();
      }
      entries.addLast(
          new WindowEntry(submission.audience(), ContentRules.redact(submission.text()), now));
    }
    if (recentWindows.size() > MAX_RECENT_PLAYERS) {
      evictExpiredPlayers(cutoff);
    }
  }

  private ContentRules.RecentWindow snapshotWindow(UUID player, String audience) {
    var entries = recentWindows.get(player);
    if (entries == null) return ContentRules.RecentWindow.EMPTY;
    var cutoff = time.instant().minus(RECENT_WINDOW);
    var matching = new ArrayList<String>();
    int count;
    synchronized (entries) {
      pruneExpired(entries, cutoff);
      count = entries.size();
      for (var entry : entries) {
        if (entry.audience().equals(audience)) {
          matching.add(entry.text());
        }
      }
    }
    return new ContentRules.RecentWindow(matching, count);
  }

  private static void pruneExpired(ArrayDeque<WindowEntry> entries, Instant cutoff) {
    while (!entries.isEmpty() && entries.peekFirst().at().isBefore(cutoff)) {
      entries.removeFirst();
    }
  }

  private void evictExpiredPlayers(Instant cutoff) {
    for (var entry : recentWindows.entrySet()) {
      var deque = entry.getValue();
      boolean empty;
      synchronized (deque) {
        pruneExpired(deque, cutoff);
        empty = deque.isEmpty();
      }
      if (empty) {
        recentWindows.remove(entry.getKey(), deque);
      }
    }
  }

  /** Persists a synchronous Stage-1 rejection, strike and mute without calling the classifier. */
  public CompletableFuture<ContentReview> recordInstantBlock(
      ContentSubmission original, ContentRules.InstantBlock block) {
    var submission = sanitized(original);
    var at = time.instant();
    var deadline = at.plusSeconds(config.publicationTimeoutSeconds());
    var persisted = store.attempt(submission, at);
    return enqueue(submission, persisted, () -> persistInstantBlock(submission, block, deadline));
  }

  private CompletableFuture<ContentReview> persistInstantBlock(
      ContentSubmission submission, ContentRules.InstantBlock block, Instant deadline) {
    if (!time.instant().isBefore(deadline))
      return finish(submission.id(), "queue-expired")
          .thenCompose(done ->
              CompletableFuture.failedFuture(
                  new IllegalStateException("Content publication deadline exceeded")));
    var work =
        enabled
            .apply(submission.player())
            .thenCompose(screen -> {
              var base = verdict("block", block.category(), block.reason(), 0);
              return block.applyStrike() && screen
                  ? withPenalty(submission, base, deadline)
                  : CompletableFuture.completedFuture(base);
            })
            .thenCompose(review ->
                store
                    .event(
                        submission.id(),
                        "decision",
                        JSON.writeValueAsString(review),
                        time.instant())
                    .thenCompose(done -> reviews.apply(submission, review))
                    .thenCompose(done -> applyPenalty(submission, review, deadline))
                    .thenCompose(
                        applied -> finish(submission.id(), "block").thenApply(d -> applied)));
    return work.orTimeout(config.publicationTimeoutSeconds(), TimeUnit.SECONDS)
        .exceptionallyCompose(failure ->
            store
                .event(
                    submission.id(),
                    "unavailable",
                    "Stage-1 rejection evidence incomplete; no additional strike.",
                    time.instant())
                .thenCompose(done ->
                    CompletableFuture.failedFuture(
                        new IllegalStateException(
                            "Stage-1 rejection persistence failed", failure))));
  }

  @Override
  public CompletableFuture<ContentReview> check(ContentSubmission original) {
    return enqueueCheck(original, true);
  }

  @Override
  public CompletableFuture<ContentReview> checkDelivered(ContentSubmission original) {
    return enqueueCheck(original, false);
  }

  private record Inspection(
      boolean sensitive, boolean checkMute, Instant submittedAt, Instant deadline) {}

  private CompletableFuture<ContentReview> enqueueCheck(
      ContentSubmission original, boolean checkMute) {
    var submission = sanitized(original);
    var at = time.instant();
    var deadline = at.plusSeconds(config.publicationTimeoutSeconds());
    var persisted = store.attempt(submission, at);
    var sensitive =
        !submission.text().equals(original.text())
            || !submission.name().equals(original.name())
            || !submission.audience().equals(original.audience())
            || !submission.components().equals(original.components())
            || !submission.object().equals(original.object());
    var inspection = new Inspection(sensitive, checkMute, at, deadline);
    return enqueue(submission, persisted, () -> inspect(submission, inspection));
  }

  private CompletableFuture<ContentReview> enqueue(
      ContentSubmission submission,
      CompletableFuture<Void> persisted,
      java.util.function.Supplier<CompletableFuture<ContentReview>> action) {
    var queue = queues.computeIfAbsent(submission.player(), ignored -> new Queue());
    synchronized (queue) {
      if (queue.pending >= config.maxPendingPerPlayer()) {
        var review =
            verdict("review", "spam", "Too many pending submissions; wait for the queue.", 0);
        return persisted
            .thenCompose(done -> finish(submission.id(), "queue-full"))
            .thenApply(done -> review);
      }
      queue.pending++;
      queue.waiting.add(submission.id());
      var result =
          queue
              .tail
              .handle((done, failure) -> null)
              .thenCompose(done -> persisted)
              .thenCompose(done -> {
                queue.waiting.remove(submission.id());
                return action.get();
              });
      queue.tail =
          result.handle((done, failure) -> {
            queue.waiting.remove(submission.id());
            synchronized (queue) {
              queue.pending--;
            }
            return null;
          });
      return result.copy().orTimeout(config.publicationTimeoutSeconds(), TimeUnit.SECONDS);
    }
  }

  private CompletableFuture<ContentReview> inspect(
      ContentSubmission submission, Inspection inspection) {
    var deadline = inspection.deadline();
    if (!time.instant().isBefore(deadline))
      return finish(submission.id(), "queue-expired")
          .thenCompose(done ->
              CompletableFuture.failedFuture(
                  new IllegalStateException("Content publication deadline exceeded")));
    var work =
        enabled
            .apply(submission.player())
            .thenCompose(screen -> evaluateSubmission(submission, inspection, screen))
            .thenCompose(review -> {
              if (!time.instant().isBefore(deadline))
                return CompletableFuture.failedFuture(
                    new IllegalStateException("Content publication deadline exceeded"));
              return store
                  .event(
                      submission.id(), "decision", JSON.writeValueAsString(review), time.instant())
                  .thenCompose(done -> reviews.apply(submission, review))
                  .thenCompose(done -> applyPenalty(submission, review, deadline));
            });
    return work.orTimeout(config.publicationTimeoutSeconds(), TimeUnit.SECONDS)
        .exceptionallyCompose(failure ->
            store
                .event(
                    submission.id(),
                    "unavailable",
                    "Content remains unpublished; no strike.",
                    time.instant())
                .thenCompose(done ->
                    CompletableFuture.failedFuture(
                        new IllegalStateException(
                            "Content screening temporarily unavailable", failure))));
  }

  private CompletableFuture<ContentReview> evaluateSubmission(
      ContentSubmission submission, Inspection inspection, boolean screen) {
    if (inspection.sensitive())
      return CompletableFuture.completedFuture(
          verdict(
              "block",
              "none",
              "Remove credential-shaped content before publishing. No misconduct strike was recorded.",
              0));
    var muteState =
        inspection.checkMute()
            ? muted.apply(submission.player())
            : CompletableFuture.completedFuture(false);
    return muteState.thenCompose(isMuted -> {
      if (isMuted && !Set.of("ticket", "command").contains(submission.surface()))
        return CompletableFuture.completedFuture(
            verdict(
                "block",
                "none",
                "You are muted or chat state is still loading. Reports to staff remain available.",
                0));
      if (!screen)
        return CompletableFuture.completedFuture(
            verdict("allow", "none", "Screening rollout disabled; attempt retained.", 0)
                .withoutScreening());
      return store
          .recent(submission.player(), time.instant().minusSeconds(20), 64)
          .thenCompose(recent -> classify(submission, recent, inspection));
    });
  }

  private boolean isEarlier(
      ContentSubmission submission, Instant submittedAt, EvidenceStore.Entry entry) {
    if (entry.submission().id().equals(submission.id())) return false;
    if (entry.at().isAfter(submittedAt)) return false;
    var queue = queues.get(submission.player());
    return queue == null || !queue.waiting.contains(entry.submission().id());
  }

  private CompletableFuture<ContentReview> classify(
      ContentSubmission submission, List<EvidenceStore.Entry> recent, Inspection inspection) {
    var deadline = inspection.deadline();
    var earlier =
        recent.stream()
            .filter(entry -> isEarlier(submission, inspection.submittedAt(), entry))
            .toList();
    var obvious =
        ContentRules.obvious(
            submission.text(),
            Set.of("chat", "message", "discord").contains(submission.surface())
                ? earlier.stream()
                    .filter(entry -> entry.submission().audience().equals(submission.audience()))
                    .map(entry -> entry.submission().text())
                    .toList()
                : List.of(),
            Set.of("ticket", "command", "command-content").contains(submission.surface()));
    if (obvious.isEmpty()) obvious = ContentRules.obvious(submission.name(), List.of(), false);
    if (obvious.isPresent() && submission.surface().equals("companion-reply"))
      return CompletableFuture.completedFuture(
          verdict(
              "block",
              obvious.orElseThrow(),
              "Unsafe model-generated output withheld; no human strike.",
              0));
    if (obvious.isPresent())
      return withPenalty(
          submission,
          verdict("block", obvious.orElseThrow(), "Clear repeated-link spam or explicit slur.", 0),
          deadline);
    if (Set.of("chat", "message", "discord").contains(submission.surface())
        && earlier.stream()
                .filter(entry ->
                    Set.of("chat", "message", "discord").contains(entry.submission().surface()))
                .count()
            >= 24)
      return CompletableFuture.completedFuture(
          verdict("block", "spam", "Please slow down; ordinary conversation resumes shortly.", 0));
    return store
        .context(submission.audience(), time.instant().minusSeconds(300), 8)
        .thenCompose(conversation -> windows(submission, conversation, deadline));
  }

  private CompletableFuture<ContentReview> windows(
      ContentSubmission submission, List<EvidenceStore.Entry> conversation, Instant deadline) {
    var context =
        conversation.reversed().stream()
            .map(entry -> entry.submission().name() + ": " + entry.submission().text())
            .reduce("", (all, line) -> all + "\n" + line);
    var surrounding =
        context.length() <= 8000 ? context : context.substring(context.length() - 8000);
    CompletableFuture<ContentReview> result =
        CompletableFuture.completedFuture(verdict("allow", "none", "Empty content.", 0));
    var complete =
        submission.components().isBlank()
            ? submission.text()
            : submission.text() + "\nStructured content:\n" + submission.components();
    for (var window : ContentRules.windows(complete)) {
      result =
          result.thenCompose(previous -> {
            if (!previous.allowed()) return CompletableFuture.completedFuture(previous);
            if (!time.instant().isBefore(deadline))
              return CompletableFuture.failedFuture(
                  new IllegalStateException("Content deadline exceeded"));
            return classifier
                .classify(submission, window, surrounding)
                .thenCompose(review ->
                    store
                        .event(
                            submission.id(),
                            "window-decision",
                            JSON.writeValueAsString(review),
                            time.instant())
                        .thenApply(done ->
                            new ContentReview(
                                review.decision(),
                                review.category(),
                                review.confidence(),
                                review.reason(),
                                review.model(),
                                Math.addExact(previous.costMicros(), review.costMicros()),
                                review.muteSeconds(),
                                review.scores(),
                                review.screened())));
          });
    }
    return result.thenCompose(review -> advertising(submission, review, deadline));
  }

  private CompletableFuture<ContentReview> advertising(
      ContentSubmission submission, ContentReview review, Instant deadline) {
    if (review.category().equals("advertising")
        && review.decision().equals("block")
        && review.confidence() >= .98) {
      return store
          .advertisingWarnings(
              submission.player(),
              time.instant().minus(DAY),
              deadline.minusSeconds(config.publicationTimeoutSeconds()))
          .thenCompose(strikes ->
              store
                  .event(
                      submission.id(),
                      "advertising",
                      "Confirmed unsolicited promotion; notification receipt is recorded separately.",
                      time.instant())
                  .thenCompose(done ->
                      strikes > 0
                          ? withPenalty(submission, review, deadline)
                          : CompletableFuture.completedFuture(review)));
    }
    return CompletableFuture.completedFuture(review);
  }

  private CompletableFuture<ContentReview> withPenalty(
      ContentSubmission submission, ContentReview review, Instant deadline) {
    return store
        .strikes(submission.player(), "penalty", time.instant().minus(WEEK))
        .thenCompose(strikes -> {
          if (!time.instant().isBefore(deadline))
            return CompletableFuture.failedFuture(
                new IllegalStateException("Content deadline exceeded"));
          var seconds = strikes > 0 ? 3600 : 600;
          return CompletableFuture.completedFuture(
              new ContentReview(
                  review.decision(),
                  review.category(),
                  review.confidence(),
                  review.reason(),
                  review.model(),
                  review.costMicros(),
                  seconds,
                  review.scores(),
                  review.screened()));
        });
  }

  private CompletableFuture<ContentReview> applyPenalty(
      ContentSubmission submission, ContentReview review, Instant deadline) {
    if (review.muteSeconds() == 0) return CompletableFuture.completedFuture(review);
    return store
        .event(submission.id(), "penalty-intent", review.category(), time.instant())
        .thenCompose(done -> {
          if (!time.instant().isBefore(deadline))
            return CompletableFuture.failedFuture(
                new IllegalStateException("Content deadline exceeded"));
          return penalty
              .apply(
                  new com.shepherdjerred.thestorm.core.safety.ContentPenalty(
                      submission, review, deadline))
              .thenCompose(applied ->
                  store.event(submission.id(), "penalty", review.category(), time.instant()))
              .thenApply(saved -> review);
        });
  }

  private static ContentReview verdict(String decision, String category, String reason, int mute) {
    return new ContentReview(
        decision, category, 1, reason, "deterministic-v1", 0, mute, java.util.Map.of(), true);
  }

  private static ContentSubmission sanitized(ContentSubmission submission) {
    return new ContentSubmission(
        submission.id(),
        submission.player(),
        ContentRules.redact(submission.name()),
        submission.surface(),
        ContentRules.redact(submission.audience()),
        ContentRules.redact(submission.text()),
        ContentRules.redact(submission.components()),
        ContentRules.redact(submission.object()));
  }

  @Override
  public CompletableFuture<Void> finish(UUID submission, String outcome) {
    return store.event(submission, outcome, "", time.instant());
  }

  @Override
  public CompletableFuture<Void> overturn(UUID submission, UUID staff) {
    return store.event(submission, "overturned", "Reviewer " + staff, time.instant());
  }

  @Override
  public CompletableFuture<Void> observe(ContentSubmission submission, String outcome) {
    return store
        .attempt(sanitized(submission), time.instant())
        .thenCompose(done -> finish(submission.id(), outcome));
  }

  /** Activity batches retain each snapshot and receipt in one shared-writer transaction. */
  public CompletableFuture<Void> observeBatch(List<EvidenceStore.Observation> observations) {
    return store.observations(
        observations.stream()
            .map(observation ->
                new EvidenceStore.Observation(
                    sanitized(observation.submission()), observation.outcome(), observation.at()))
            .toList());
  }
}
