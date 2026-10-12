package com.shepherdjerred.thestorm.discord.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Global chat from inside a sealed world never reaches the relay, whichever thread delivers it. */
final class SealedPlayersTest {

  private final SealedWorlds sealed = new SealedWorlds();
  private final List<String> relayed = new ArrayList<>();
  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    sealed.seal("arena");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private static ChatLine line(PlayerMock player, String text) {
    return new ChatLine(
        Instant.EPOCH, new ChatAuthor.InGame(player.getUniqueId(), player.getName()), text);
  }

  @Test
  void followsPlayersBetweenWorldsAndForgetsThemOnQuit() {
    var arena = server.addSimpleWorld("arena");
    var alice = server.addPlayer("Alice");
    var bot = server.addPlayer("Bot");
    bot.teleport(new Location(arena, 0.5, 5, 0.5));
    var players = SealedPlayers.track(server, sealed);
    var relay = players.guarding(line -> relayed.add(line.text()));

    relay.accept(line(alice, "hello from the overworld"));
    relay.accept(line(bot, "gg from the match"));
    assertThat(relayed).containsExactly("hello from the overworld");

    alice.teleport(new Location(arena, 1.5, 5, 1.5));
    players.onWorldChange(new PlayerChangedWorldEvent(alice, server.getWorld("world")));
    relay.accept(line(alice, "now inside"));
    assertThat(relayed).containsExactly("hello from the overworld");

    bot.teleport(new Location(server.getWorld("world"), 1.5, 5, 1.5));
    players.onWorldChange(new PlayerChangedWorldEvent(bot, arena));
    relay.accept(line(bot, "back outside"));
    assertThat(relayed).containsExactly("hello from the overworld", "back outside");

    players.onQuit(
        new PlayerQuitEvent(bot, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
    assertThat(players.inSealedWorld(bot.getUniqueId())).isFalse();
  }

  @Test
  void aJoinInsideASealedWorldIsTrackedAndExternalLinesAlwaysPass() {
    var arena = server.addSimpleWorld("arena");
    var players = SealedPlayers.track(server, sealed);
    var bot = server.addPlayer("Bot");
    bot.teleport(new Location(arena, 0.5, 5, 0.5));
    players.onJoin(new PlayerJoinEvent(bot, Component.empty()));
    var relay = players.guarding(line -> relayed.add(line.text()));

    relay.accept(line(bot, "spawned in the match"));
    relay.accept(new ChatLine(Instant.EPOCH, new ChatAuthor.External("D", "dave"), "from discord"));

    assertThat(relayed).containsExactly("from discord");
  }

  @Test
  void answersOffTheMainThreadWithoutTouchingTheServer() throws Exception {
    var arena = server.addSimpleWorld("arena");
    var bot = server.addPlayer("Bot");
    bot.teleport(new Location(arena, 0.5, 5, 0.5));
    var players = SealedPlayers.track(server, sealed);
    var unknown = UUID.randomUUID();

    try (var chat = Executors.newVirtualThreadPerTaskExecutor()) {
      var answers =
          CompletableFuture.supplyAsync(
                  () ->
                      List.of(
                          players.inSealedWorld(bot.getUniqueId()), players.inSealedWorld(unknown)),
                  chat)
              .get();
      assertThat(answers).containsExactly(true, false);
    }
  }
}
