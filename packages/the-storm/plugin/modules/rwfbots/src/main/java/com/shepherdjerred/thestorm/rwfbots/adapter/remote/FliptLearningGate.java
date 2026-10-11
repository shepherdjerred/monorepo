package com.shepherdjerred.thestorm.rwfbots.adapter.remote;

import com.shepherdjerred.thestorm.rwfbots.app.learning.LearningGate;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import tools.jackson.databind.json.JsonMapper;

/**
 * The managed match-scoped flag. Successful invalid values and missing declared flags are errors.
 */
public final class FliptLearningGate implements LearningGate {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final String NAMESPACE_KEY = "the-storm";
  private static final String FLAG_KEY = "the-storm-rwfbots-learning-enabled";
  private final HttpClient client;
  private final URI endpoint;
  private final String environment;

  public FliptLearningGate(URI base, String environment) {
    if ((!"http".equals(base.getScheme()) && !"https".equals(base.getScheme()))
        || base.getHost() == null
        || base.getUserInfo() != null
        || base.getQuery() != null)
      throw new IllegalArgumentException("Flipt requires an uncredentialed HTTP server address");
    if (!"prod".equals(environment) && !"beta".equals(environment))
      throw new IllegalArgumentException("unknown Flipt environment: " + environment);
    endpoint = base.resolve("/evaluate/v1/boolean");
    client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    this.environment = environment;
  }

  @Override
  public CompletableFuture<Decision> evaluate(Context context) {
    var body =
        JSON.writeValueAsString(
            Map.of(
                "namespace_key",
                NAMESPACE_KEY,
                "flag_key",
                FLAG_KEY,
                "entity_id",
                context.match().toString(),
                "context",
                Map.of(
                    "match",
                    context.match().toString(),
                    "map",
                    context.map(),
                    "world",
                    context.world())));
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofSeconds(3))
            .header("Content-Type", "application/json")
            .header("x-flipt-environment", environment)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .handle(
            (response, failure) -> {
              if (failure == null) return parse(response);
              var cause = failure instanceof CompletionException ? failure.getCause() : failure;
              if (cause instanceof IOException) return new Decision(false, Source.UNAVAILABLE);
              throw new CompletionException(failure);
            });
  }

  static Decision parse(HttpResponse<String> response) {
    if (response.statusCode() == 429 || response.statusCode() >= 500)
      return new Decision(false, Source.UNAVAILABLE);
    if (response.statusCode() != 200)
      throw new IllegalStateException(
          "Flipt learning evaluation returned HTTP " + response.statusCode());
    var enabled = JSON.readTree(response.body()).get("enabled");
    if (enabled == null || !enabled.isBoolean())
      throw new IllegalStateException("Flipt learning evaluation requires a boolean enabled value");
    return new Decision(enabled.booleanValue(), Source.FLIPT);
  }

  @Override
  public void close() {
    client.shutdown();
  }
}
