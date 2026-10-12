package com.shepherdjerred.thestorm.companions.adapter.http;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig.Identity;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

final class CompanionHttpTest {
  private record Exchange(String path, String environment, String body) {}

  private record Script(int status, String body) {}

  private record Server(HttpServer http, URI address) implements AutoCloseable {
    @Override
    public void close() {
      http.stop(0);
    }
  }

  private static Server server(Script response, List<Exchange> exchanges) throws Exception {
    var http = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    http.createContext(
        "/",
        request -> {
          exchanges.add(
              new Exchange(
                  request.getRequestURI().getPath(),
                  java.util.Objects.requireNonNullElse(
                      request.getRequestHeaders().getFirst("x-flipt-environment"), ""),
                  new String(request.getRequestBody().readAllBytes(), UTF_8)));
          var bytes = response.body().getBytes(UTF_8);
          request.sendResponseHeaders(response.status(), bytes.length);
          request.getResponseBody().write(bytes);
          request.close();
        });
    http.start();
    return new Server(http, URI.create("http://127.0.0.1:" + http.getAddress().getPort()));
  }

  @Test
  void evaluatesTheManagedGameplayFlagInTheRightEnvironment() throws Exception {
    var exchanges = new ArrayList<Exchange>();
    try (var server = server(new Script(200, "{\"enabled\":true}"), exchanges);
        var gate = new FliptCompanionGate(server.address(), "beta")) {
      assertThat(gate.enabled().get(5, TimeUnit.SECONDS)).isTrue();
    }
    assertThat(exchanges).hasSize(1);
    assertThat(exchanges.getFirst().path()).isEqualTo("/evaluate/v1/boolean");
    assertThat(exchanges.getFirst().environment()).isEqualTo("beta");
    assertThat(exchanges.getFirst().body())
        .contains("\"namespace_key\":\"the-storm\"", "the-storm-companions-enabled");
  }

  @Test
  void refusesUnavailableAndMalformedFlags() throws Exception {
    for (var script :
        java.util.List.of(
            new Script(503, "unavailable"), new Script(200, "{\"enabled\":\"true\"}"))) {
      try (var server = server(script, new ArrayList<>());
          var gate = new FliptCompanionGate(server.address(), "prod")) {
        assertThatThrownBy(() -> gate.enabled().get(5, TimeUnit.SECONDS))
            .hasRootCauseInstanceOf(IllegalStateException.class);
      }
    }
  }

  @Test
  void acceptsTextAndRejectsGameActionsInAReply() throws Exception {
    var identity = new Identity("rowan", "Rowan", "Friendly builder");
    try (var server =
            server(
                new Script(200, "{\"text\":\"Hello\",\"model\":\"gpt-6-luna\",\"costMicros\":1}"),
                new ArrayList<>());
        var conversation = new HttpConversation(server.address(), "synthetic-test-token")) {
      assertThat(conversation.reply(identity, "Hi", "8 logs").get(5, TimeUnit.SECONDS))
          .contains("Hello");
    }
    try (var server =
            server(
                new Script(
                    200,
                    "{\"text\":\"Hello\",\"model\":\"gpt-6-luna\",\"costMicros\":1,\"action\":\"mine\"}"),
                new ArrayList<>());
        var conversation = new HttpConversation(server.address(), "synthetic-test-token")) {
      assertThatThrownBy(
              () -> conversation.reply(identity, "Hi", "8 logs").get(5, TimeUnit.SECONDS))
          .hasRootCauseInstanceOf(tools.jackson.databind.exc.UnrecognizedPropertyException.class);
    }
    try (var server = server(new Script(429, "unavailable"), new ArrayList<>());
        var conversation = new HttpConversation(server.address(), "synthetic-test-token")) {
      assertThat(conversation.reply(identity, "Hi", "8 logs").get(5, TimeUnit.SECONDS)).isEmpty();
    }
  }
}
