package com.shepherdjerred.thestorm.safety.adapter.http;

import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.app.ContentClassifier;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Provider and HTTP failures never become approvals; retries run on owned virtual threads. */
public final class HttpContentClassifier implements ContentClassifier, AutoCloseable {
  private final java.util.concurrent.ExecutorService executor =
      Executors.newVirtualThreadPerTaskExecutor();
  private final HttpClient http = HttpClient.newBuilder().executor(executor).build();
  private final JsonMapper json =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
          .build();
  private final URI uri;
  private final String token;
  private final Duration timeout;

  public HttpContentClassifier(String url, String token, int timeoutMillis) {
    var contract =
        com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.load(
            "content-moderation");
    com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.fields(
        contract, "requestFields", Request.class);
    com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.fields(
        contract, "responseFields", Answer.class);
    if (contract.required("maxTextChars").asInt() != 4000
        || contract.required("maxContextChars").asInt() != 8000)
      throw new IllegalStateException("Content limits differ from shared contract");
    for (var category :
        com.shepherdjerred.thestorm.safety.adapter.contract.SharedContracts.strings(
            contract, "categories"))
      new ContentReview("allow", category, 1, "contract", "contract", 0, 0, java.util.Map.of());
    this.uri = URI.create(url.replaceAll("/+$", "") + "/v1/moderate");
    if (uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getQuery() != null
        || !(uri.getScheme().equals("http") || uri.getScheme().equals("https")))
      throw new IllegalArgumentException("Invalid content service origin");
    if (token.isBlank()) throw new IllegalArgumentException("Missing safety bearer token");
    this.token = token;
    this.timeout = Duration.ofMillis(timeoutMillis);
  }

  private record Request(
      int version,
      java.util.UUID submissionId,
      java.util.UUID authorId,
      String authorName,
      String surface,
      String audience,
      String text,
      String context) {}

  private record Answer(
      int version,
      String decision,
      String category,
      double confidence,
      String reason,
      String model,
      long costMicros,
      java.util.Map<String, Double> scores) {
    ContentReview review() {
      if (version != 1) throw new IllegalArgumentException("Unknown content contract version");
      return new ContentReview(
          decision, category, confidence, reason, model, costMicros, 0, scores);
    }
  }

  @Override
  public CompletableFuture<ContentReview> classify(
      ContentSubmission submission, String text, String context) {
    var request =
        HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Authorization", "Bearer " + token)
            .header("Content-Type", "application/json")
            .POST(
                HttpRequest.BodyPublishers.ofString(
                    json.writeValueAsString(
                        new Request(
                            1,
                            submission.id(),
                            submission.player(),
                            submission.name(),
                            submission.surface(),
                            submission.audience(),
                            text,
                            context))))
            .build();
    return CompletableFuture.supplyAsync(() -> send(request), executor);
  }

  private ContentReview send(HttpRequest request) {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        var verdict = answer(response);
        if (verdict != null) return verdict;
        if (attempt == 2)
          throw new IllegalStateException(
              "Content service unavailable: HTTP " + response.statusCode());
        Thread.sleep(Duration.ofMillis(250L * (attempt + 1)));
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException("Content classification interrupted", interrupted);
      } catch (java.io.IOException failure) {
        if (attempt == 2)
          throw new IllegalStateException("Content service transport unavailable", failure);
      }
    }
    throw new IllegalStateException("Content service exhausted retries");
  }

  private @org.jspecify.annotations.Nullable ContentReview answer(HttpResponse<String> response) {
    if (response.statusCode() == 200) {
      try {
        return json.readValue(response.body(), Answer.class).review();
      } catch (RuntimeException invalid) {
        throw new IllegalArgumentException("Content service returned an invalid verdict");
      }
    }
    if (response.statusCode() != 429 && response.statusCode() < 500)
      throw new IllegalArgumentException(
          "Content contract rejected: HTTP " + response.statusCode());
    return null;
  }

  @Override
  public void close() {
    http.shutdownNow();
    executor.shutdownNow();
  }
}
