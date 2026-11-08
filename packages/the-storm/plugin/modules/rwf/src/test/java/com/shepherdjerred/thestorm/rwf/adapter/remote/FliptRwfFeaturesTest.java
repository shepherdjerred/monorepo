package com.shepherdjerred.thestorm.rwf.adapter.remote;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

final class FliptRwfFeaturesTest {
  private record Reply(int status, String body) {}

  private static void withProvider(
      String environment, int status, String body, Consumer<FliptRwfFeatures> verify)
      throws IOException {
    withProvider(environment, false, () -> new Reply(status, body), verify);
  }

  private static void withProvider(
      String environment,
      boolean allRequests,
      Supplier<Reply> reply,
      Consumer<FliptRwfFeatures> verify)
      throws IOException {
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/evaluate/v1/boolean",
        exchange -> {
          String request;
          try (var input = exchange.getRequestBody()) {
            request = new String(input.readAllBytes(), UTF_8);
          }
          var selected =
              allRequests
                  || request.contains("rwf-host-settings-enabled")
                  || request.contains("rwf-candidate-visits-enabled");
          var response = selected ? reply.get() : new Reply(200, "{\"enabled\":true}");
          var bytes = response.body().getBytes(UTF_8);
          exchange.sendResponseHeaders(response.status(), bytes.length);
          try (var output = exchange.getResponseBody()) {
            output.write(bytes);
          }
        });
    server.start();
    try (var flags =
        new FliptRwfFeatures(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()), environment, "rwf")) {
      verify.accept(flags);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void productionOutageUsesApprovedDefaultsWithoutChangingOtherFeatures() throws IOException {
    withProvider(
        "prod",
        503,
        "unavailable",
        flags -> {
          var features = flags.evaluate().join();
          assertThat(features.hostSettings()).isTrue();
          assertThat(features.candidateVisits()).isTrue();
          assertThat(features.matchFlow()).isTrue();
        });
    withProvider(
        "beta",
        503,
        "unavailable",
        flags ->
            assertThatThrownBy(() -> flags.evaluate().join())
                .hasRootCauseMessage("Flipt HTTP 503"));
  }

  @Test
  void aFullOutageStillEnablesOnlyApprovedDefaultsOnTheFirstRead() throws IOException {
    withProvider(
        "prod",
        true,
        () -> new Reply(503, "unavailable"),
        flags -> {
          var features = flags.evaluate().join();
          assertThat(features.hostSettings()).isTrue();
          assertThat(features.candidateVisits()).isTrue();
          assertThat(features.matchFlow()).isFalse();
          assertThat(features.carryOver()).isFalse();
          assertThat(features.deathFeed()).isFalse();
          assertThat(features.teamChat()).isFalse();
          assertThat(features.spectatorTools()).isFalse();
          assertThat(features.bombEffects()).isFalse();
          assertThat(features.stats()).isFalse();
        });
  }

  @Test
  void aFullOutageKeepsEveryLastKnownAnswerIncludingExplicitFalse() throws IOException {
    for (var enabled : new boolean[] {false, true}) {
      var reply = new AtomicReference<>(new Reply(200, "{\"enabled\":" + enabled + "}"));
      withProvider(
          "prod",
          true,
          reply::get,
          flags -> {
            var before = flags.evaluate().join();
            reply.set(new Reply(503, "unavailable"));
            assertThat(flags.evaluate().join()).isEqualTo(before);
            assertThat(before.hostSettings()).isEqualTo(enabled);
            assertThat(before.candidateVisits()).isEqualTo(enabled);
            assertThat(before.matchFlow()).isEqualTo(enabled);
          });
    }
  }

  @Test
  void explicitFalseRemainsAuthoritative() throws IOException {
    withProvider(
        "prod",
        200,
        "{\"enabled\":false}",
        flags -> {
          var features = flags.evaluate().join();
          assertThat(features.hostSettings()).isFalse();
          assertThat(features.candidateVisits()).isFalse();
          assertThat(features.matchFlow()).isTrue();
        });
  }

  @Test
  void missingAndMalformedAnswersNeverBecomeApprovedDefaults() throws IOException {
    withProvider(
        "prod",
        404,
        "missing",
        flags ->
            assertThatThrownBy(() -> flags.evaluate().join())
                .hasRootCauseMessage("Flipt evaluation returned HTTP 404"));
    withProvider(
        "prod",
        200,
        "{\"enabled\":\"false\"}",
        flags ->
            assertThatThrownBy(() -> flags.evaluate().join())
                .hasRootCauseMessage("Flipt boolean evaluation is missing enabled"));
  }
}
