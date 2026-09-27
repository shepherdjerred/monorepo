package com.shepherdjerred.thestorm.world.adapter.paper;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.concurrent.CompletionException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class FliptCrierGateTest {

  @Test
  void evaluatesTheManagedFlagForThePlayer() throws Exception {
    var response = new AtomicReference<>("{\"enabled\":true}");
    var status = new AtomicInteger(200);
    var request = new AtomicReference<String>();
    var server =
        HttpServer.create(
            new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 0);
    server.createContext(
        "/evaluate/v1/boolean",
        exchange -> {
          request.set(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
          var bytes = response.get().getBytes(UTF_8);
          exchange.sendResponseHeaders(status.get(), bytes.length);
          try (var body = exchange.getResponseBody()) {
            body.write(bytes);
          }
        });
    server.start();
    try (var gate =
        new FliptCrierGate(
            java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort()))) {
      var player = randomUUID();
      assertThat(gate.enabled(player).join()).isTrue();
      assertThat(request.get())
          .contains(
              "\"environment_key\":\"prod\"",
              "\"namespace_key\":\"the-storm\"",
              "\"flag_key\":\"the-storm-crier-enabled\"",
              player.toString());

      response.set("{\"enabled\":false}");
      assertThat(gate.enabled(player).join()).isFalse();

      response.set("{\"enabled\":\"true\"}");
      assertThatThrownBy(() -> gate.enabled(player).join())
          .isInstanceOf(CompletionException.class)
          .hasCauseInstanceOf(IllegalStateException.class);

      response.set("{\"enabled\":true}");
      status.set(503);
      assertThatThrownBy(() -> gate.enabled(player).join())
          .isInstanceOf(CompletionException.class)
          .hasCauseInstanceOf(IllegalStateException.class);
    } finally {
      server.stop(0);
    }
  }
}
