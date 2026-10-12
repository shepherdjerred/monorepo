package com.shepherdjerred.thestorm.discord.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.players.PlayerJoinAnnouncementEvent;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.discord.app.DiscordConfig;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** The Paper listener on MockBukkit: a sealed world's players never reach Discord. */
final class ServerEventsListenerTest {

  private static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/discord.yml");

  private final List<String> posts = new ArrayList<>();
  private final SealedWorlds sealed = new SealedWorlds();
  private ServerMock server;
  private ServerEventsListener listener;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    var config = ConfigFiles.load(SHIPPED, DiscordConfig.class);
    var relay =
        new DiscordRelay(
            config, posts::add, new DiscordRelay.Game(new SilentChat(), new Inline(), List::of));
    listener = new ServerEventsListener(relay, new VanillaPlainText(new EmptyLanguage()), sealed);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void relaysJoinsLeavesAndDeathsFromOrdinaryWorlds() {
    var alice = server.addPlayer("Alice");

    listener.onJoin(new PlayerJoinEvent(alice, Component.empty()));
    listener.onDeath(death(alice, "Alice fell from a high place"));
    listener.onQuit(
        new PlayerQuitEvent(alice, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));

    assertThat(posts)
        .containsExactly(
            "**Alice** joined the server",
            "Alice fell from a high place",
            "**Alice** left the server");
  }

  @Test
  void relaysNothingAboutPlayersInASealedWorld() {
    sealed.seal("arena");
    var arena = server.addSimpleWorld("arena");
    var bot = server.addPlayer("Bot");
    bot.teleport(new Location(arena, 0.5, 5, 0.5));

    listener.onJoin(new PlayerJoinEvent(bot, Component.empty()));
    listener.onDeath(death(bot, "Bot was shot"));
    listener.onQuit(
        new PlayerQuitEvent(bot, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));

    assertThat(posts).isEmpty();
  }

  @Test
  void defersJoinRelayUntilStaffVisibilityResolution() {
    var player = server.addPlayer("HiddenOnReconnect");
    var token = PlayerVisibility.deferJoinAnnouncement(player.getUniqueId());

    listener.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(posts).isEmpty();

    PlayerVisibility.resolveJoinAnnouncement(player.getUniqueId(), token);
    listener.onJoinAnnouncementResolved(new PlayerJoinAnnouncementEvent(player, false));
    assertThat(posts).isEmpty();
    listener.onJoinAnnouncementResolved(new PlayerJoinAnnouncementEvent(player, true));
    assertThat(posts).containsExactly("**HiddenOnReconnect** joined the server");
  }

  @Test
  void doesNotRelayQuitWhenJoinVisibilityIsStillPending() {
    var player = server.addPlayer("PendingVisibility");
    var token = PlayerVisibility.deferJoinAnnouncement(player.getUniqueId());

    listener.onQuit(
        new PlayerQuitEvent(player, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));

    assertThat(posts).isEmpty();
    PlayerVisibility.resolveJoinAnnouncement(player.getUniqueId(), token);
  }

  private static PlayerDeathEvent death(PlayerMock player, String message) {
    var event =
        new PlayerDeathEvent(
            player,
            DamageSource.builder(DamageType.GENERIC).build(),
            new ArrayList<>(),
            0,
            Component.text(message),
            false);
    event.setShowDeathMessages(true);
    return event;
  }

  /** MockBukkit ships no Minecraft language file; plain death messages need none. */
  private static final class EmptyLanguage extends ClassLoader {
    @Override
    public @Nullable InputStream getResourceAsStream(String name) {
      return new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8));
    }
  }

  private static final class SilentChat implements GlobalChat {
    @Override
    public Subscription subscribe(Consumer<ChatLine> listener) {
      return () -> {};
    }

    @Override
    public void broadcastExternal(String source, String author, String text) {}
  }

  private static final class Inline implements Scheduler {
    @Override
    public void runOnMainThread(Runnable task) {
      task.run();
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      throw new UnsupportedOperationException();
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new UnsupportedOperationException();
    }

    @Override
    public Executor mainThread() {
      return Runnable::run;
    }
  }
}
