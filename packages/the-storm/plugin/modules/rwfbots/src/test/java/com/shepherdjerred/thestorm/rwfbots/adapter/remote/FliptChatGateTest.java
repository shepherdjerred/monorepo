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
    var environment = new AtomicReference<String>();
    var server =
        HttpServer.create(
            new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 0);
    server.createContext(
        "/evaluate/v1/boolean",
        exchange -> {
          request.set(new String(exchange.getRequestBody().readAllBytes(), UTF_8));
          environment.set(exchange.getRequestHeaders().getFirst("x-flipt-environment"));
          var bytes = response.get().getBytes(UTF_8);
          exchange.sendResponseHeaders(status.get(), bytes.length);
          try (var body = exchange.getResponseBody()) {
            body.write(bytes);
          }
        });
    server.start();
    try (var gate =
        new FliptChatGate(
            URI.create("http://127.0.0.1:" + server.getAddress().getPort()), "beta", "rwf")) {
      assertThat(gate.enabled().join()).isTrue();
      assertThat(request.get())
          .isEqualTo(
              "{\"namespace_key\":\"the-storm\",\"flag_key\":\"the-storm-rwfbots-chat-enabled\","
                  + "\"entity_id\":\"the-storm-rwfbots-chat\",\"context\":{\"world\":\"rwf\"}}");
      assertThat(environment.get()).isEqualTo("beta");

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
          .hasCauseInstanceOf(IllegalStateException.class);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void refusesAnAddressOrEnvironmentItCannotTrust() {
    assertThatThrownBy(() -> new FliptChatGate(URI.create("ftp://flipt"), "prod", "rwf"))
        .hasMessageContaining("HTTP");
    assertThatThrownBy(() -> new FliptChatGate(URI.create("http://user@flipt"), "prod", "rwf"))
        .hasMessageContaining("uncredentialed");
    assertThatThrownBy(() -> new FliptChatGate(URI.create("http://flipt"), "staging", "rwf"))
        .hasMessageContaining("environment");
  }
}
