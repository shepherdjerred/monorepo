package com.shepherdjerred.thestorm.mechanics.adapter.remote;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class FlagsStargatesGateTest {
  @Test
  void evaluatesServerRolloutAndRejectsInvalidOrFailedResponses() throws Exception {
    var response = new AtomicReference<>("{\"enabled\":true}");
    var status = new AtomicInteger(200);
    var request = new AtomicReference<String>();
    var authorization = new AtomicReference<String>();
    var server =
        HttpServer.create(
            new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 0);
    server.createContext(
        "/v1/evaluate",
        exchange -> {
          request.set(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
          authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
          var bytes = response.get().getBytes(UTF_8);
          exchange.sendResponseHeaders(status.get(), bytes.length);
          try (var body = exchange.getResponseBody()) {
            body.write(bytes);
          }
        });
    server.start();
    try (var gate =
        new FlagsStargatesGate(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "the-storm/beta")) {
      assertThat(gate.enabled().join()).isTrue();
      assertThat(request.get())
          .contains(
              "\"deployment\":\"the-storm/beta\"",
              "the-storm-stargates-enabled",
              "the-storm-server");
      assertThat(authorization.get()).isNull();
      response.set("{\"enabled\":false}");
      assertThat(gate.enabled().join()).isFalse();
      response.set("{\"enabled\":\"true\"}");
      assertThatThrownBy(() -> gate.enabled().join()).isInstanceOf(CompletionException.class);
      status.set(503);
      assertThatThrownBy(() -> gate.enabled().join()).isInstanceOf(CompletionException.class);
    } finally {
      server.stop(0);
    }
  }
}
