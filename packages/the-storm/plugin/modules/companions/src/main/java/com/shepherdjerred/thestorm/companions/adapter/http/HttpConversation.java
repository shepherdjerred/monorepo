package com.shepherdjerred.thestorm.companions.adapter.http;

import com.shepherdjerred.thestorm.companions.app.ConversationService;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig.Identity;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Strict shared wire limits, bounded replies, no HTTP retries and no gameplay output. */
public final class HttpConversation implements ConversationService {
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private record Contract(
      int version,
      List<String> identities,
      int maxPersonalityChars,
      int maxMessageChars,
      int maxContextChars,
      int maxReplyChars,
      int maxOutputTokens,
      int monthlyBudgetMicroUsd,
      String timeZone,
      List<String> requestFields,
      List<String> responseFields) {}

  private record Request(
      String requestId, String identity, String personality, String message, String context) {}

  private record Reply(String text, String model, long costMicros) {}

  private final Contract contract;
  private final URI endpoint;
  private final String token;
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

  public HttpConversation(URI base, String token) {
    if ((!"http".equals(base.getScheme()) && !"https".equals(base.getScheme()))
        || base.getHost() == null
        || base.getUserInfo() != null
        || base.getQuery() != null
        || token.isBlank()) throw new IllegalArgumentException("invalid conversation bootstrap");
    endpoint = base.resolve("/v1/conversation");
    this.token = token;
    try (var stream =
        HttpConversation.class.getResourceAsStream("/contracts/companion-chat.json")) {
      if (stream == null) throw new IllegalStateException("shared companion contract is missing");
      contract = JSON.readValue(stream.readAllBytes(), Contract.class);
    } catch (IOException error) {
      throw new IllegalStateException("cannot load companion contract", error);
    }
    if (contract.version() != 1
        || !contract
            .requestFields()
            .equals(List.of("requestId", "identity", "personality", "message", "context"))
        || !contract.responseFields().equals(List.of("text", "model", "costMicros")))
      throw new IllegalStateException("companion wire fields disagree with shared contract");
  }

  @Override
  public CompletableFuture<Optional<String>> reply(
      Identity identity, String message, String context) {
    if (!contract.identities().contains(identity.id())
        || identity.personality().length() > contract.maxPersonalityChars()
        || message.isBlank()
        || message.length() > contract.maxMessageChars()
        || context.length() > contract.maxContextChars())
      return CompletableFuture.failedFuture(
          new IllegalArgumentException("conversation exceeds shared wire limits"));
    var body =
        new Request(
            UUID.randomUUID().toString(), identity.id(), identity.personality(), message, context);
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofSeconds(25))
            .header("Authorization", "Bearer " + token)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .thenApply(
            response -> {
              if (response.statusCode() == 429 || response.statusCode() == 503)
                return Optional.empty();
              if (response.statusCode() != 200)
                throw new IllegalStateException(
                    "companion conversation returned HTTP " + response.statusCode());
              if (response.body().length() > 4096)
                throw new IllegalStateException("companion conversation response exceeds limits");
              var reply = JSON.readValue(response.body(), Reply.class);
              if (reply.text().isBlank()
                  || reply.text().length() > contract.maxReplyChars()
                  || reply.model().isBlank()
                  || reply.costMicros() < 0)
                throw new IllegalStateException("invalid companion conversation response");
              return Optional.of(reply.text());
            });
  }

  @Override
  public void close() {
    client.shutdownNow();
  }
}
