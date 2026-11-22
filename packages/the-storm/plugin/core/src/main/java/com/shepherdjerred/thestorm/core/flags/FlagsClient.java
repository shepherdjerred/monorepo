package com.shepherdjerred.thestorm.core.flags;

import com.shepherdjerred.thestorm.core.expansion.FlagProviderUnavailableException;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/** Shared credentialless HTTP client for {@code POST /v1/evaluate}. */
public final class FlagsClient implements AutoCloseable {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(3);

  private final HttpClient client;
  private final URI endpoint;
  private final String deployment;
  private final String stage;

  public FlagsClient(URI base, String deployment) {
    this.endpoint = validateBase(base).resolve("/v1/evaluate");
    this.deployment = validateDeployment(deployment);
    this.stage = deploymentStage(this.deployment);
    this.client = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
  }

  public static FlagsClient open(String url, String deployment) {
    return new FlagsClient(URI.create(url), deployment);
  }

  public static URI validateBase(URI base) {
    if (!"http".equals(base.getScheme()) && !"https".equals(base.getScheme())) {
      throw new IllegalArgumentException("Flags URL must use HTTP or HTTPS");
    }
    if (base.getHost() == null
        || base.getUserInfo() != null
        || base.getQuery() != null
        || base.getFragment() != null) {
      throw new IllegalArgumentException(
          "Flags URL must be an uncredentialed server address without query or fragment");
    }
    return base;
  }

  public static String validateDeployment(String deployment) {
    var slash = deployment.indexOf('/');
    if (slash <= 0 || slash != deployment.lastIndexOf('/') || slash == deployment.length() - 1) {
      throw new IllegalArgumentException("Invalid flags deployment: " + deployment);
    }
    var catalog = deployment.substring(0, slash);
    var stageName = deployment.substring(slash + 1);
    if (catalog.isBlank()
        || stageName.isBlank()
        || catalog.chars().anyMatch(Character::isWhitespace)
        || stageName.chars().anyMatch(Character::isWhitespace)) {
      throw new IllegalArgumentException("Invalid flags deployment: " + deployment);
    }
    return deployment;
  }

  public static String deploymentStage(String deployment) {
    validateDeployment(deployment);
    if ("minecraft/tsmc".equals(deployment) || deployment.endsWith("/prod")) {
      return "prod";
    }
    if ("minecraft/sandbox".equals(deployment) || deployment.endsWith("/beta")) {
      return "beta";
    }
    throw new IllegalArgumentException("Unknown flags deployment stage: " + deployment);
  }

  public String deployment() {
    return deployment;
  }

  public String stage() {
    return stage;
  }

  public CompletableFuture<Boolean> evaluate(String key, Map<String, String> context) {
    if (key.isBlank()) {
      throw new IllegalArgumentException("Flag key must not be blank");
    }
    var payload = new LinkedHashMap<String, Object>(3);
    payload.put("deployment", deployment);
    payload.put("key", key);
    payload.put("context", Map.copyOf(context));
    var body = JSON.writeValueAsString(payload);
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(REQUEST_TIMEOUT)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .exceptionallyCompose(failure -> {
          var cause = FlagProviderUnavailableException.unwrap(failure);
          return CompletableFuture.failedFuture(
              cause instanceof IOException ? new FlagProviderUnavailableException(cause) : cause);
        })
        .thenApply(FlagsClient::parseResponse);
  }

  private static boolean parseResponse(HttpResponse<String> response) {
    var status = response.statusCode();
    if (status == 429 || (status >= 500 && status < 600)) {
      throw new FlagProviderUnavailableException(
          new IllegalStateException("Flags evaluation returned HTTP " + status));
    }
    if (status != 200) {
      throw new IllegalStateException("Flags evaluation returned HTTP " + status);
    }
    try {
      var enabled = JSON.readTree(response.body()).get("enabled");
      if (enabled == null || !enabled.isBoolean()) {
        throw new IllegalStateException("Flags evaluation response lacks boolean enabled");
      }
      return enabled.booleanValue();
    } catch (JacksonException e) {
      throw new IllegalStateException("Flags evaluation response lacks boolean enabled", e);
    }
  }

  @Override
  public void close() {
    client.shutdownNow();
  }
}
