package com.shepherdjerred.thestorm.towns.adapter.remote;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class FliptRentalGateTest {
  @Test
  void evaluatesTheManagedKeyForThePlayerInTheSelectedEnvironment() throws Exception {
    var request = new AtomicReference<String>();
    var environment = new AtomicReference<String>();
    var server =
        HttpServer.create(
            new InetSocketAddress(java.net.InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0),
            0);
    server.createContext(
        "/evaluate/v1/boolean",
        exchange -> {
          request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          environment.set(exchange.getRequestHeaders().getFirst("x-flipt-environment"));
          var bytes = "{\"enabled\":true}".getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    try (var gate =
        new FliptRentalGate(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "beta")) {
      var owner = UUID.randomUUID();
      assertThat(gate.enabled(owner).get(5, TimeUnit.SECONDS)).isTrue();
      assertThat(request.get()).contains(FliptRentalGate.FLAG_KEY, owner.toString(), "the-storm");
      assertThat(environment.get()).isEqualTo("beta");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void malformedEvaluationFailsInsteadOfAdmittingAPlayer() throws Exception {
    var server =
        HttpServer.create(
            new InetSocketAddress(java.net.InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0),
            0);
    server.createContext(
        "/evaluate/v1/boolean",
        exchange -> {
          var bytes = "{\"enabled\":\"true\"}".getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    try (var gate =
        new FliptRentalGate(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "prod")) {
      assertThatThrownBy(() -> gate.enabled(UUID.randomUUID()).get(5, TimeUnit.SECONDS))
          .hasRootCauseInstanceOf(IllegalStateException.class);
    } finally {
      server.stop(0);
    }
  }
}
