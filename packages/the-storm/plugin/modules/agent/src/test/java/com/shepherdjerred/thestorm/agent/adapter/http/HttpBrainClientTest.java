package com.shepherdjerred.thestorm.agent.adapter.http;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.agent.app.BrainDisabledException;
import com.shepherdjerred.thestorm.agent.app.BrainException;
import com.shepherdjerred.thestorm.agent.app.ClassifyCase;
import com.shepherdjerred.thestorm.agent.app.TriageCase;
import com.shepherdjerred.thestorm.agent.domain.ChatSample;
import com.shepherdjerred.thestorm.essentials.app.ModLogRecord;
import com.shepherdjerred.thestorm.tickets.app.CommentSnapshot;
import com.shepherdjerred.thestorm.tickets.app.LocationSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

final class HttpBrainClientTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");
  private static final JsonMapper JSON = JsonMapper.builder().build();

  private record Exchange(String path, String authorization, String contentType, String body) {}

  private record Script(int status, String body) {}

  private record Scripted(HttpBrainClient client, HttpServer server) implements AutoCloseable {
    @Override
    public void close() {
      try {
        client.close();
      } finally {
        server.stop(0);
      }
    }
  }

  @Test
  void classifyPostsCaseAndParsesVerdict() throws Exception {
    var exchanges = new ArrayList<Exchange>();
    var script =
        """
        {"offense":"spam","confidence":0.9,"label":"spam-burst","reasoning":"six identical lines",\
        "model":"gpt-5.6-luna","costMicros":42}\
        """;
    try (var brain = scripted(exchanges, new Script(200, script))) {
      var verdict =
          brain
              .client()
              .classify(
                  new ClassifyCase(
                      ALICE, "Alice", List.of(sample("buy gold cheap"), sample("hello"))))
              .get(10, TimeUnit.SECONDS);

      assertThat(verdict.offenseId()).contains("spam");
      assertThat(verdict.confidence()).isEqualTo(0.9);
      assertThat(verdict.label()).isEqualTo("spam-burst");
      assertThat(verdict.reasoning()).isEqualTo("six identical lines");
      assertThat(verdict.model()).isEqualTo("gpt-5.6-luna");
      assertThat(verdict.costMicros()).isEqualTo(42);
    }

    assertThat(exchanges).hasSize(1);
    var sent = exchanges.getFirst();
    assertThat(sent.path()).isEqualTo("/v1/classify");
    assertThat(sent.authorization()).isEqualTo("Bearer test-token");
    assertThat(sent.contentType()).startsWith("application/json");
    var body = JSON.readTree(sent.body());
    assertThat(body.get("player").get("id").asString()).isEqualTo(ALICE.toString());
    assertThat(body.get("player").get("name").asString()).isEqualTo("Alice");
    assertThat(body.get("lines").size()).isEqualTo(2);
    assertThat(body.get("lines").get(0).get("text").asString()).isEqualTo("buy gold cheap");
  }

  @Test
  void classifyMapsCleanVerdicts() throws Exception {
    var script =
        """
        {"offense":null,"confidence":0.99,"label":"clean","reasoning":"normal chat",\
        "model":"gpt-5.6-luna","costMicros":7}\
        """;
    try (var brain = scripted(new ArrayList<>(), new Script(200, script))) {
      var verdict =
          brain
              .client()
              .classify(new ClassifyCase(ALICE, "Alice", List.of(sample("hello"))))
              .get(10, TimeUnit.SECONDS);

      assertThat(verdict.offenseId()).isEmpty();
    }
  }

  @Test
  void classifySendsAtMostEightLines() throws Exception {
    var exchanges = new ArrayList<Exchange>();
    var script =
        """
        {"offense":null,"confidence":0.5,"label":"clean","reasoning":"x","model":"m","costMicros":0}\
        """;
    var lines = new ArrayList<ChatSample>();
    for (var i = 0; i < 12; i++) {
      lines.add(sample("line " + i));
    }
    try (var brain = scripted(exchanges, new Script(200, script))) {
      brain.client().classify(new ClassifyCase(ALICE, "Alice", lines)).get(10, TimeUnit.SECONDS);
    }

    var body = JSON.readTree(exchanges.getFirst().body());
    assertThat(body.get("lines").size()).isEqualTo(8);
    assertThat(body.get("lines").get(0).get("text").asString()).isEqualTo("line 0");
  }

  @Test
  void classifyDropsBlankLines() throws Exception {
    var exchanges = new ArrayList<Exchange>();
    var script =
        """
        {"offense":null,"confidence":0.5,"label":"clean","reasoning":"x","model":"m","costMicros":0}\
        """;
    try (var brain = scripted(exchanges, new Script(200, script))) {
      brain
          .client()
          .classify(new ClassifyCase(ALICE, "Alice", List.of(sample("  "), sample("hello"))))
          .get(10, TimeUnit.SECONDS);
    }

    var body = JSON.readTree(exchanges.getFirst().body());
    assertThat(body.get("lines").size()).isEqualTo(1);
  }

  @Test
  void classifyFailsFastWithoutLines() {
    try (var brain =
        new HttpBrainClient(URI.create("http://127.0.0.1:1"), "t", Duration.ofSeconds(1))) {
      assertThatThrownBy(() -> brain.classify(new ClassifyCase(ALICE, "Alice", List.of())))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("at least one non-blank line");
    }
  }

  @Test
  void triagePostsCaseAndParsesProposal() throws Exception {
    var exchanges = new ArrayList<Exchange>();
    var script =
        """
        {"priorityId":"urgent","confidence":0.92,"duplicates":[3],"evidence":"wall broken",\
        "draftReply":"looking into it","resolve":false,"resolutionNote":"",\
        "model":"gpt-5.6-luna","costMicros":100}\
        """;
    var kase =
        new TriageCase(
            new TicketSnapshot(
                1,
                ALICE,
                "grief",
                "open",
                "normal",
                "my wall is gone",
                Optional.of(new LocationSnapshot("world", 1, 64, -2)),
                NOW,
                NOW,
                Optional.empty(),
                Optional.empty(),
                "test"),
            List.of(new CommentSnapshot(9, ALICE, false, "it was stone", NOW)),
            List.of(new ModLogRecord("mute", "Mod", "spam", NOW, Optional.empty())),
            false,
            List.of(sample("hello")));
    try (var brain = scripted(exchanges, new Script(200, script))) {
      var proposal = brain.client().triage(kase).get(10, TimeUnit.SECONDS);

      assertThat(proposal.priorityId()).isEqualTo("urgent");
      assertThat(proposal.confidence()).isEqualTo(0.92);
      assertThat(proposal.duplicates()).containsExactly(3L);
      assertThat(proposal.evidence()).isEqualTo("wall broken");
      assertThat(proposal.draftReply()).isEqualTo("looking into it");
      assertThat(proposal.resolve()).isFalse();
      assertThat(proposal.model()).isEqualTo("gpt-5.6-luna");
      assertThat(proposal.costMicros()).isEqualTo(100);
    }

    assertThat(exchanges).hasSize(1);
    var sent = exchanges.getFirst();
    assertThat(sent.path()).isEqualTo("/v1/triage");
    var body = JSON.readTree(sent.body());
    assertThat(body.get("ticket").get("id").asLong()).isEqualTo(1);
    assertThat(body.get("ticket").get("location").get("world").asString()).isEqualTo("world");
    assertThat(body.get("ticket").get("claimer").isNull()).isTrue();
    assertThat(body.get("comments").size()).isEqualTo(1);
    assertThat(body.get("reporterHistory").get(0).get("actionId").asString()).isEqualTo("mute");
    assertThat(body.get("reporterBanned").asBoolean()).isFalse();
  }

  @Test
  void mapsDisabledFlows() throws Exception {
    try (var brain = scripted(new ArrayList<>(), new Script(503, "flow disabled\n"))) {
      assertThatThrownBy(
              () ->
                  brain
                      .client()
                      .classify(new ClassifyCase(ALICE, "Alice", List.of(sample("hello"))))
                      .get(10, TimeUnit.SECONDS))
          .hasRootCauseInstanceOf(BrainDisabledException.class);
    }
  }

  @Test
  void mapsServiceErrors() throws Exception {
    try (var brain = scripted(new ArrayList<>(), new Script(502, "upstream error\n"))) {
      assertThatThrownBy(
              () ->
                  brain
                      .client()
                      .classify(new ClassifyCase(ALICE, "Alice", List.of(sample("hello"))))
                      .get(10, TimeUnit.SECONDS))
          .hasRootCauseInstanceOf(BrainException.class)
          .hasRootCauseMessage("storm-brain classify answered 502: upstream error");
    }
  }

  @Test
  void rejectsAnswersOutsideTheContract() throws Exception {
    var script =
        """
        {"offense":null,"confidence":0.5,"label":"clean","reasoning":"x","model":"m",\
        "costMicros":0,"surprise":"skew"}\
        """;
    try (var brain = scripted(new ArrayList<>(), new Script(200, script))) {
      assertThatThrownBy(
              () ->
                  brain
                      .client()
                      .classify(new ClassifyCase(ALICE, "Alice", List.of(sample("hello"))))
                      .get(10, TimeUnit.SECONDS))
          .cause()
          .isInstanceOf(BrainException.class)
          .hasMessageContaining("outside the contract");
    }
  }

  @Test
  void failsCallsWhenUnreachable() throws Exception {
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.start();
    var port = server.getAddress().getPort();
    server.stop(0);
    try (var brain =
        new HttpBrainClient(URI.create("http://127.0.0.1:" + port), "t", Duration.ofSeconds(5))) {
      assertThatThrownBy(
              () ->
                  brain
                      .classify(new ClassifyCase(ALICE, "Alice", List.of(sample("hello"))))
                      .get(10, TimeUnit.SECONDS))
          .cause()
          .isInstanceOf(BrainException.class)
          .hasMessageContaining("call failed");
    }
  }

  private static ChatSample sample(String text) {
    return new ChatSample(ALICE, "Alice", text, NOW);
  }

  /** A client pointed at a server that answers every call with {@code script}. */
  private static Scripted scripted(List<Exchange> exchanges, Script script) throws Exception {
    var server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/",
        exchange -> {
          var body = new String(exchange.getRequestBody().readAllBytes(), UTF_8);
          synchronized (exchanges) {
            exchanges.add(
                new Exchange(
                    exchange.getRequestURI().getPath(),
                    exchange.getRequestHeaders().getFirst("Authorization"),
                    exchange.getRequestHeaders().getFirst("Content-Type"),
                    body));
          }
          var bytes = script.body().getBytes(UTF_8);
          exchange.sendResponseHeaders(script.status(), bytes.length);
          try (var out = exchange.getResponseBody()) {
            out.write(bytes);
          }
        });
    server.start();
    var port = server.getAddress().getPort();
    return new Scripted(
        new HttpBrainClient(
            URI.create("http://127.0.0.1:" + port), "test-token", Duration.ofSeconds(5)),
        server);
  }
}
