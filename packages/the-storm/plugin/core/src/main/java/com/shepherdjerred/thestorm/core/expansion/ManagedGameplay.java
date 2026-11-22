package com.shepherdjerred.thestorm.core.expansion;

import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiFunction;

/** Shared asynchronous rollout reader. Every command evaluates its actor. */
public final class ManagedGameplay implements AutoCloseable {
  private static final Duration CACHE_TTL = Duration.ofSeconds(30);

  private record EvaluationKey(String key, UUID actor) {}

  private record CachedEvaluation(boolean enabled, Instant expires) {}

  record OutageDefaults(boolean ipEnforcement, Set<String> enabled) {
    OutageDefaults {
      enabled = Set.copyOf(enabled);
    }
  }

  public static final String STAFF = "the-storm-staff-tools-enabled";
  public static final String IDENTITY = "the-storm-identity-enabled";
  public static final String LETTERS = "the-storm-letters-enabled";
  public static final String IP = "the-storm-ip-enforcement-enabled";
  public static final String ANALYTICS = "the-storm-analytics-enabled";
  public static final String BEGINNERS_LUCK = "the-storm-beginners-luck-enabled";
  public static final String CONTENT_SAFETY = "the-storm-content-safety-enabled";
  public static final String ASYNC_CHAT_MODERATION = "the-storm-async-chat-moderation-enabled";
  public static final String ANTICHEAT_CORRECTIONS = "the-storm-anticheat-corrections-enabled";
  public static final String STATS_EXPORT = "the-storm-stats-export-enabled";
  private final BiFunction<String, UUID, CompletableFuture<Boolean>> reader;
  private final Runnable stop;
  private final InstantSource time;
  private final OutageDefaults outageDefaults;
  private final Map<EvaluationKey, CachedEvaluation> evaluations = new ConcurrentHashMap<>();
  private final Map<EvaluationKey, Boolean> lastSuccessful = new ConcurrentHashMap<>();
  private final Map<EvaluationKey, CompletableFuture<Boolean>> inFlight = new ConcurrentHashMap<>();

  public ManagedGameplay(
      BiFunction<String, UUID, CompletableFuture<Boolean>> reader, Runnable stop) {
    this(reader, stop, true, InstantSource.system());
  }

  public ManagedGameplay(
      BiFunction<String, UUID, CompletableFuture<Boolean>> reader,
      Runnable stop,
      boolean ipEnforcementDefault) {
    this(reader, stop, ipEnforcementDefault, InstantSource.system());
  }

  public ManagedGameplay(
      BiFunction<String, UUID, CompletableFuture<Boolean>> reader,
      Runnable stop,
      boolean ipEnforcementDefault,
      InstantSource time) {
    this(reader, stop, time, new OutageDefaults(ipEnforcementDefault, Set.of()));
  }

  ManagedGameplay(
      BiFunction<String, UUID, CompletableFuture<Boolean>> reader,
      Runnable stop,
      InstantSource time,
      OutageDefaults outageDefaults) {
    this.reader = reader;
    this.stop = stop;
    this.time = time;
    this.outageDefaults = outageDefaults;
  }

  public static ManagedGameplay remote(String url, String deployment) {
    var client = FlagsClient.open(url, deployment);
    var prod = "prod".equals(client.stage());
    return new ManagedGameplay(
        (key, actor) -> client.evaluate(key, Map.of("user", actor.toString())),
        client::close,
        InstantSource.system(),
        new OutageDefaults(
            !prod,
            prod
                ? Set.of(STAFF, IDENTITY, LETTERS, ASYNC_CHAT_MODERATION, STATS_EXPORT)
                : Set.of(ASYNC_CHAT_MODERATION)));
  }

  public CompletableFuture<Boolean> enabled(String key, UUID actor) {
    return reader
        .apply(key, actor)
        .thenApply(enabled -> {
          if (outageDefaults.enabled().contains(key))
            lastSuccessful.put(new EvaluationKey(key, actor), enabled);
          return enabled;
        })
        .exceptionally(failure -> {
          var cause = FlagProviderUnavailableException.unwrap(failure);
          if (!outageDefaults.enabled().contains(key)
              || !(cause instanceof FlagProviderUnavailableException))
            throw new java.util.concurrent.CompletionException(cause);
          System.getLogger(ManagedGameplay.class.getName())
              .log(
                  System.Logger.Level.WARNING,
                  "Flag provider unavailable; retaining the last successful value or declared default for {0}",
                  key);
          return lastSuccessful.getOrDefault(new EvaluationKey(key, actor), true);
        })
        .thenApply(enabled -> {
          var now = time.instant();
          evaluations
              .entrySet()
              .removeIf(entry ->
                  !retainsLastKnown(entry.getKey().key())
                      && !now.isBefore(entry.getValue().expires()));
          evaluations.put(
              new EvaluationKey(key, actor), new CachedEvaluation(enabled, now.plus(CACHE_TTL)));
          return enabled;
        });
  }

  /** Uses and briefly caches the declared default only for an observed provider outage. */
  public CompletableFuture<Boolean> enabledOrDefault(
      String key,
      UUID actor,
      boolean fallback,
      java.util.function.Consumer<Throwable> unavailable) {
    return enabled(key, actor)
        .exceptionally(failure -> {
          var cause = FlagProviderUnavailableException.unwrap(failure);
          if (!(cause instanceof FlagProviderUnavailableException))
            throw new java.util.concurrent.CompletionException(cause);
          unavailable.accept(cause);
          evaluations.put(
              new EvaluationKey(key, actor),
              new CachedEvaluation(fallback, time.instant().plus(CACHE_TTL)));
          return fallback;
        });
  }

  /**
   * A fresh, previously completed rollout result for boundaries that cannot wait on the network.
   */
  public Optional<Boolean> cachedEnabled(String key, UUID actor) {
    var evaluation = new EvaluationKey(key, actor);
    var cached = evaluations.get(evaluation);
    if (cached == null) return Optional.empty();
    if (!time.instant().isBefore(cached.expires())) {
      if (!retainsLastKnown(key)) evaluations.remove(evaluation, cached);
      return Optional.empty();
    }
    return Optional.of(cached.enabled());
  }

  private static boolean retainsLastKnown(String key) {
    return IP.equals(key) || ASYNC_CHAT_MODERATION.equals(key) || CONTENT_SAFETY.equals(key);
  }

  /** Last completed result, including an expired IP-enforcement decision while it refreshes. */
  public Optional<Boolean> lastKnownEnabled(String key, UUID actor) {
    var cached = evaluations.get(new EvaluationKey(key, actor));
    return cached == null ? Optional.empty() : Optional.of(cached.enabled());
  }

  /** Starts a deduplicated background refresh when the cached rollout entry is missing or stale. */
  public CompletableFuture<Boolean> prime(
      String key,
      UUID actor,
      boolean fallback,
      java.util.function.Consumer<Throwable> unavailable) {
    var cached = cachedEnabled(key, actor);
    if (cached.isPresent()) return CompletableFuture.completedFuture(cached.orElseThrow());
    return refresh(key, actor, fallback, unavailable);
  }

  /**
   * Returns a cached or synchronously available rollout decision without blocking, refreshing
   * expired entries in the background.
   */
  public boolean nonblockingEnabled(
      String key,
      UUID actor,
      boolean fallback,
      java.util.function.Consumer<Throwable> unavailable) {
    var cached = cachedEnabled(key, actor);
    if (cached.isPresent()) return cached.orElseThrow();
    var previous = lastKnownEnabled(key, actor);
    var refresh = refresh(key, actor, fallback, unavailable);
    if (refresh.isDone() && !refresh.isCompletedExceptionally()) {
      return refresh.getNow(fallback);
    }
    return previous.orElse(fallback);
  }

  private CompletableFuture<Boolean> refresh(
      String key,
      UUID actor,
      boolean fallback,
      java.util.function.Consumer<Throwable> unavailable) {
    var evaluation = new EvaluationKey(key, actor);
    var started =
        inFlight.computeIfAbsent(
            evaluation, ignored -> enabledOrDefault(key, actor, fallback, unavailable));
    var _ = started.whenComplete((done, failure) -> inFlight.remove(evaluation, started));
    return started;
  }

  /** The registered environment default used if the IP-enforcement flag cannot be read. */
  public boolean ipEnforcementDefault() {
    return outageDefaults.ipEnforcement();
  }

  @Override
  public void close() {
    stop.run();
  }
}
