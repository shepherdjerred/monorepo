package com.shepherdjerred.castlecasters.session;

import static org.junit.jupiter.api.Assertions.*;

import com.shepherdjerred.castlecasters.session.SessionState.*;
import io.netty.buffer.*;
import io.netty.channel.embedded.EmbeddedChannel;
import java.net.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

public class NetworkSessionTest {
  private static void pump(
      GameSession session, SessionHost host, List<SessionClient> clients, BooleanSupplier done)
      throws Exception {
    long end = System.nanoTime() + 8_000_000_000L;
    do {
      session.update();
      host.update();
      clients.forEach(SessionClient::update);
      if (done.getAsBoolean()) return;
      Thread.sleep(5);
    } while (System.nanoTime() < end);
    fail(
        "Network condition timed out: phase="
            + session.snapshot().phase()
            + ", clients="
            + clients.stream()
                .map(c -> c.status() + "/seat=" + c.seat() + "/connected=" + c.connected())
                .toList());
  }

  @Test
  void framingHandlesPartialAndCoalescedMessages() {
    var channel = new EmbeddedChannel();
    SessionWire.pipeline(channel.pipeline());
    byte[] text =
        SessionWire.JSON
            .toJson(SessionWire.message("ping"))
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    var bytes =
        Unpooled.buffer()
            .writeInt(text.length)
            .writeBytes(text)
            .writeInt(text.length)
            .writeBytes(text);
    assertFalse(channel.writeInbound(bytes.readRetainedSlice(2)));
    assertFalse(channel.writeInbound(bytes.readRetainedSlice(5)));
    assertTrue(channel.writeInbound(bytes));
    assertNotNull(channel.readInbound());
    assertNotNull(channel.readInbound());
    assertNull(channel.readInbound());
    channel.finishAndReleaseAll();
    assertThrows(
        IllegalArgumentException.class,
        () -> SessionWire.parse("{\"version\":1,\"type\":\"hello\"}"));
  }

  @Test
  void twoAndFourPlayerSocketSessionsReconnectAndEnd() throws Exception {
    for (int count : List.of(2, 4))
      try (var session = new GameSession();
          var host = new SessionHost(session, 0)) {
        session.resize(count);
        for (int i = 2; i <= count; i++) {
          var s = session.snapshot().seats().get(i - 1);
          session.seat(
              new Seat(i, "Remote " + i, s.element(), Controller.REMOTE, s.difficulty(), false));
        }
        var clients = new ArrayList<SessionClient>();
        try {
          for (int i = 2; i <= count; i++)
            clients.add(
                new SessionClient(new InetSocketAddress("127.0.0.1", host.port()), "Remote " + i));
          pump(
              session,
              host,
              clients,
              () ->
                  clients.stream().allMatch(c -> c.snapshot() != null)
                      && session.snapshot().seats().stream().allMatch(Seat::connected));
          assertEquals(count - 1, clients.stream().map(SessionClient::seat).distinct().count());
          if (count == 4) assertThrows(IllegalArgumentException.class, () -> session.resize(2));
          session.start();
          pump(
              session,
              host,
              clients,
              () -> clients.stream().allMatch(c -> c.snapshot().phase() == Phase.PLAYING));
          session.turn(
              "host",
              session.snapshot().revision(),
              new TurnData("MOVE", 1, 8, 2, 0, 0),
              Set.of(1));
          for (int i = 2; i <= count; i++) {
            final int active = i;
            pump(
                session,
                host,
                clients,
                () ->
                    clients.stream().allMatch(c -> c.snapshot().match().activePlayer() == active));
            var owner = clients.stream().filter(c -> c.seat() == active).findFirst().orElseThrow();
            var match = session.match();
            var move =
                new com.shepherdjerred.castlecasters.logic.turn.generator.TurnGenerator(
                        new com.shepherdjerred.castlecasters.logic.turn.validator
                            .TurnValidatorFactory())
                    .generateValidPawnTurns(match)
                    .iterator()
                    .next();
            owner.turn(TurnData.of(move));
            pump(session, host, clients, () -> session.snapshot().match().activePlayer() != active);
          }
          pump(
              session,
              host,
              clients,
              () ->
                  clients.stream()
                      .allMatch(c -> c.snapshot().revision() == session.snapshot().revision()));
          for (var c : clients) assertEquals(session.snapshot().match(), c.snapshot().match());
        } finally {
          clients.forEach(SessionClient::close);
        }
      }
  }

  @Test
  void turnsPauseAndRejoinStayAuthoritative() throws Exception {
    try (var session = new GameSession();
        var host = new SessionHost(session, 0)) {
      var s = session.snapshot().seats().get(1);
      session.seat(new Seat(2, "Remote", s.element(), Controller.REMOTE, s.difficulty(), false));
      try (var client =
          new SessionClient(new InetSocketAddress("127.0.0.1", host.port()), "Guest")) {
        var clients = List.of(client);
        pump(session, host, clients, () -> client.snapshot() != null);
        session.start();
        pump(session, host, clients, () -> client.snapshot().phase() == Phase.PLAYING);
        long revision = session.snapshot().revision();
        client.turn(new TurnData("MOVE", 1, 8, 2, 0, 0));
        pump(session, host, clients, () -> !client.pending());
        assertEquals(revision, session.snapshot().revision());
        session.turn("host", revision, new TurnData("MOVE", 1, 8, 2, 0, 0), Set.of(1));
        pump(
            session,
            host,
            clients,
            () -> client.snapshot().revision() == session.snapshot().revision());
        client.turn(new TurnData("MOVE", 2, 8, 14, 0, 0));
        pump(session, host, clients, () -> session.snapshot().match().activePlayer() == 1);
        client.interruptConnection();
        pump(session, host, clients, () -> session.snapshot().phase() == Phase.PAUSED);
        pump(
            session,
            host,
            clients,
            () -> session.snapshot().phase() == Phase.PLAYING && client.connected());
        assertEquals(2, client.seat());
        assertEquals("Guest", session.snapshot().seats().get(1).name());
        host.close();
        long end = System.nanoTime() + 2_000_000_000L;
        while (client.snapshot().phase() != Phase.CLOSED && System.nanoTime() < end) {
          client.update();
          Thread.sleep(5);
        }
        assertEquals(Phase.CLOSED, client.snapshot().phase());
      }
    }
  }

  @Test
  void replacementRevokesRejoinAndFullLobbyRejectsNewClient() throws Exception {
    try (var session = new GameSession();
        var host = new SessionHost(session, 0)) {
      var s = session.snapshot().seats().get(1);
      session.seat(new Seat(2, "Remote", s.element(), Controller.REMOTE, s.difficulty(), false));
      try (var client =
          new SessionClient(new InetSocketAddress("127.0.0.1", host.port()), "Guest")) {
        pump(session, host, List.of(client), client::connected);
        try (var extra =
            new SessionClient(new InetSocketAddress("127.0.0.1", host.port()), "Late guest")) {
          pump(
              session,
              host,
              List.of(client, extra),
              () -> extra.status().equals("The lobby is full"));
          assertFalse(extra.connected());
          assertNull(extra.snapshot());
        }
        session.start();
        pump(session, host, List.of(client), () -> client.snapshot().phase() == Phase.PLAYING);
        client.interruptConnection();
        pump(session, host, List.of(client), () -> session.snapshot().phase() == Phase.PAUSED);
        assertFalse(client.connected());
        session.replaceDisconnected();
        pump(session, host, List.of(client), () -> client.snapshot().phase() == Phase.CLOSED);
        assertFalse(client.connected());
        assertTrue(client.status().contains("no longer available"));
        assertEquals(Controller.AI, session.snapshot().seats().get(1).controller());
      }
    }
  }

  @Test
  void discoveryRepliesWithVersionedHostOfferAndStops() throws Exception {
    try (var discovery = new LanDiscovery(35567);
        var query = new DatagramSocket()) {
      query.setSoTimeout(2000);
      byte[] bytes =
          SessionWire.JSON
              .toJson(SessionWire.message("discover"))
              .getBytes(java.nio.charset.StandardCharsets.UTF_8);
      query.send(
          new DatagramPacket(
              bytes, bytes.length, InetAddress.getLoopbackAddress(), LanDiscovery.PORT));
      var response = new DatagramPacket(new byte[4096], 4096);
      query.receive(response);
      var offer =
          SessionWire.parse(
              new String(
                  response.getData(),
                  0,
                  response.getLength(),
                  java.nio.charset.StandardCharsets.UTF_8));
      assertEquals("offer", offer.get("type").getAsString());
      assertEquals(35567, offer.get("port").getAsInt());
    }
    assertTrue(
        Thread.getAllStackTraces().keySet().stream()
            .noneMatch(t -> t.isAlive() && t.getName().equals("CASTLE_DISCOVERY")));
  }
}
