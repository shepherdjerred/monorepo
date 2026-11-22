package com.shepherdjerred.thestorm.rwfbots.adapter.remote;

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

final class FliptChatGateTest {

  @Test
  void evaluatesTheManagedFlagForTheRwfWorld() throws Exception {
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
        new FliptChatGate(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()),
            "the-storm/beta",
            "rwf")) {
      assertThat(gate.enabled().join()).isTrue();
      assertThat(request.get())
          .isEqualTo(
              "{\"deployment\":\"the-storm/beta\",\"key\":\"the-storm-rwfbots-chat-enabled\","
                  + "\"context\":{\"world\":\"rwf\"}}");
      assertThat(authorization.get()).isNull();

      response.set("{\"enabled\":false}");
      assertThat(gate.enabled().join()).isFalse();

      response.set("{\"enabled\":\"true\"}");
      assertThatThrownBy(() -> gate.enabled().join())
          .isInstanceOf(CompletionException.class)
          .hasCauseInstanceOf(IllegalStateException.class);

      response.set("{\"enabled\":true}");
      status.set(503);
      assertThatThrownBy(() -> gate.enabled().join())
          .isInstanceOf(CompletionException.class)
          .hasRootCauseInstanceOf(IllegalStateException.class);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void refusesAnAddressOrDeploymentItCannotTrust() {
    assertThatThrownBy(() -> new FliptChatGate(URI.create("ftp://flags"), "minecraft/tsmc", "rwf"))
        .hasMessageContaining("HTTP");
    assertThatThrownBy(
            () -> new FliptChatGate(URI.create("http://user@flags"), "minecraft/tsmc", "rwf"))
        .hasMessageContaining("uncredentialed");
    assertThatThrownBy(() -> new FliptChatGate(URI.create("http://flags"), "staging", "rwf"))
        .hasMessageContaining("deployment");
    assertThatThrownBy(
            () -> new FliptChatGate(URI.create("http://flags"), "the-storm/staging", "rwf"))
        .hasMessageContaining("deployment");
  }
}
