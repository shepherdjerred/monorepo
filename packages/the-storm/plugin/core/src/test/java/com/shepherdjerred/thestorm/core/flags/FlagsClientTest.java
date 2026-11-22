package com.shepherdjerred.thestorm.core.flags;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.expansion.FlagProviderUnavailableException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

final class FlagsClientTest {
  @Test
  void postsCredentiallessEvaluationRequestsAndMapsResponses() throws Exception {
    var json = JsonMapper.builder().build();
    var status = new AtomicInteger(200);
    var responseBody = new AtomicReference<>("{\"enabled\":true}");
    var requestBody = new AtomicReference<String>();
    var authorization = new AtomicReference<String>();
    var headerNames = new AtomicReference<java.util.Set<String>>();
    var contentType = new AtomicReference<String>();
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/v1/evaluate",
        exchange -> {
          requestBody.set(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
          authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
          headerNames.set(java.util.Set.copyOf(exchange.getRequestHeaders().keySet()));
          contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
          var bytes = responseBody.get().getBytes(UTF_8);
          exchange.sendResponseHeaders(status.get(), bytes.length);
          try (var stream = exchange.getResponseBody()) {
            stream.write(bytes);
          }
        });
    server.start();
    try (var client =
        FlagsClient.open("http://127.0.0.1:" + server.getAddress().getPort(), "minecraft/tsmc")) {
      assertThat(client.stage()).isEqualTo("prod");
      assertThat(
              client
                  .evaluate(
                      "the-storm-staff-tools-enabled", Map.of("user", "player-1", "world", "world"))
                  .join())
          .isTrue();
      assertThat(authorization.get()).isNull();
      assertThat(headerNames.get())
          .noneMatch(name -> name.toLowerCase(java.util.Locale.ROOT).startsWith("x-"));
      assertThat(contentType.get()).isEqualTo("application/json");
      var parsed = json.readTree(requestBody.get());
      assertThat(parsed.path("deployment").asString()).isEqualTo("minecraft/tsmc");
      assertThat(parsed.path("key").asString()).isEqualTo("the-storm-staff-tools-enabled");
      assertThat(parsed.path("context").path("user").asString()).isEqualTo("player-1");
      assertThat(parsed.path("context").path("world").asString()).isEqualTo("world");

      responseBody.set("{\"enabled\":false}");
      assertThat(client.evaluate("the-storm-staff-tools-enabled", Map.of()).join()).isFalse();

      status.set(503);
      assertThatThrownBy(() -> client.evaluate("the-storm-staff-tools-enabled", Map.of()).join())
          .isInstanceOf(CompletionException.class)
          .hasCauseInstanceOf(FlagProviderUnavailableException.class)
          .hasRootCauseMessage("Flags evaluation returned HTTP 503");

      status.set(404);
      responseBody.set("{\"error\":\"FLAG_NOT_FOUND\"}");
      assertThatThrownBy(() -> client.evaluate("the-storm-staff-tools-enabled", Map.of()).join())
          .isInstanceOf(CompletionException.class)
          .hasCauseInstanceOf(IllegalStateException.class)
          .hasRootCauseMessage("Flags evaluation returned HTTP 404");
    } finally {
      server.stop(0);
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "ftp://flags.internal",
        "http://user@flags.internal",
        "http://flags.internal?x=1",
        "http://flags.internal#frag"
      })
  void rejectsInvalidBaseUris(String uri) {
    assertThatThrownBy(() -> new FlagsClient(URI.create(uri), "minecraft/tsmc"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "prod",
        "/prod",
        "the-storm/",
        "the-storm/a/prod",
        "the storm/prod",
        "the-storm/staging"
      })
  void rejectsInvalidDeployments(String deployment) {
    assertThatThrownBy(() -> FlagsClient.deploymentStage(deployment))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void mapsProductionAndBetaDeploymentStages() {
    assertThat(FlagsClient.deploymentStage("minecraft/tsmc")).isEqualTo("prod");
    assertThat(FlagsClient.deploymentStage("the-storm/prod")).isEqualTo("prod");
    assertThat(FlagsClient.deploymentStage("minecraft/sandbox")).isEqualTo("beta");
    assertThat(FlagsClient.deploymentStage("the-storm/beta")).isEqualTo("beta");
  }
}
