package com.shepherdjerred.thestorm.core.expansion;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiFunction;
import tools.jackson.databind.json.JsonMapper;

/** Shared asynchronous rollout reader. Every command evaluates its actor; failures fail closed. */
public final class ManagedGameplay implements AutoCloseable {
  private static final Duration CACHE_TTL = Duration.ofSeconds(30);

  private record EvaluationKey(String key, UUID actor) {}

  private record CachedEvaluation(boolean enabled, Instant expires) {}

  public static final String STAFF = "the-storm-staff-tools-enabled";
  public static final String IDENTITY = "the-storm-identity-enabled";
  public static final String LETTERS = "the-storm-letters-enabled";
  public static final String IP = "the-storm-ip-enforcement-enabled";
  private final BiFunction<String, UUID, CompletableFuture<Boolean>> reader;
  private final Runnable stop;
  private final boolean ipEnforcementDefault;
  private final InstantSource time;
  private final Map<EvaluationKey, CachedEvaluation> evaluations = new ConcurrentHashMap<>();

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
    this.reader = reader;
    this.stop = stop;
    this.ipEnforcementDefault = ipEnforcementDefault;
    this.time = time;
  }

  public static ManagedGameplay remote(String url, String environment) {
    var base = URI.create(url);
    if ((!"http".equals(base.getScheme()) && !"https".equals(base.getScheme()))
        || base.getHost() == null
        || base.getUserInfo() != null
        || base.getQuery() != null
        || (!"prod".equals(environment) && !"beta".equals(environment))) {
      throw new IllegalArgumentException("invalid gameplay rollout bootstrap");
    }
    var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    var json = JsonMapper.builder().build();
    return new ManagedGameplay(
        (key, actor) -> {
          var body =
              json.writeValueAsString(
                  Map.of(
                      "namespace_key",
                      "the-storm",
                      "flag_key",
                      key,
                      "entity_id",
                      actor.toString(),
                      "context",
                      Map.of()));
          var request =
              HttpRequest.newBuilder(base.resolve("/evaluate/v1/boolean"))
                  .timeout(Duration.ofSeconds(3))
                  .header("Content-Type", "application/json")
                  .header("x-flipt-environment", environment)
                  .POST(HttpRequest.BodyPublishers.ofString(body))
                  .build();
          return client
              .sendAsync(request, HttpResponse.BodyHandlers.ofString())
              .thenApply(
                  response -> {
                    if (response.statusCode() != 200)
                      throw new IllegalStateException(
                          "rollout returned HTTP " + response.statusCode());
                    var value = json.readTree(response.body()).get("enabled");
                    if (value == null || !value.isBoolean())
                      throw new IllegalStateException("rollout response lacks enabled");
                    return value.booleanValue();
                  });
        },
        client::shutdownNow,
        "beta".equals(environment));
  }

  public CompletableFuture<Boolean> enabled(String key, UUID actor) {
    return reader
        .apply(key, actor)
        .thenApply(
            enabled -> {
              var now = time.instant();
              evaluations.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expires()));
              evaluations.put(
                  new EvaluationKey(key, actor),
                  new CachedEvaluation(enabled, now.plus(CACHE_TTL)));
              return enabled;
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
      evaluations.remove(evaluation, cached);
      return Optional.empty();
    }
    return Optional.of(cached.enabled());
  }

  /** The registered environment default used if the IP-enforcement flag cannot be read. */
  public boolean ipEnforcementDefault() {
    return ipEnforcementDefault;
  }

  @Override
  public void close() {
    stop.run();
  }
}
