package com.shepherdjerred.thestorm.messages.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.tree.CommandNode;
import com.shepherdjerred.thestorm.messages.domain.AnnouncementPreferences;
import com.shepherdjerred.thestorm.messages.domain.Channel;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class ToggleCommandsTest {

  private ServerMock server;
  private PreferenceStore preferences;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    preferences = new PreferenceStore(MockBukkit.createMockPlugin());
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void storesMutesInThePlayersPersistentData() {
    var player = server.addPlayer();

    assertThat(preferences.read(player)).isEqualTo(AnnouncementPreferences.hearingEverything());
    assertThat(preferences.toggle(player, Channel.TIPS).hears(Channel.TIPS)).isFalse();
    assertThat(preferences.read(player).muted()).containsExactly(Channel.TIPS);
    assertThat(preferences.toggle(player, Channel.TIPS).hears(Channel.TIPS)).isTrue();
    assertThat(preferences.read(player)).isEqualTo(AnnouncementPreferences.hearingEverything());
  }

  @Test
  void keepsEachPlayersMutesSeparate() {
    var steve = server.addPlayer("Steve");
    var alex = server.addPlayer("Alex");

    preferences.toggle(steve, Channel.ADS);

    assertThat(preferences.read(steve).hears(Channel.ADS)).isFalse();
    assertThat(preferences.read(alex).hears(Channel.ADS)).isTrue();
  }

  @Test
  void toggleTipsMutesAndUnmutesWithFeedback() throws CommandSyntaxException {
    var dispatcher = dispatcher(Set.of(Channel.TIPS, Channel.ADS));
    var player = server.addPlayer();

    dispatcher.execute("toggle-tips", new Source(player));
    assertThat(plain(player.nextComponentMessage())).isEqualTo("[Tips]: Tips are now off");
    assertThat(preferences.read(player).hears(Channel.TIPS)).isFalse();
    assertThat(preferences.read(player).hears(Channel.ADS)).isTrue();

    dispatcher.execute("toggle-tips", new Source(player));
    assertThat(plain(player.nextComponentMessage())).isEqualTo("[Tips]: Tips are now on");
    assertThat(preferences.read(player).hears(Channel.TIPS)).isTrue();
  }

  @Test
  void toggleAdsMutesAds() throws CommandSyntaxException {
    var dispatcher = dispatcher(Set.of(Channel.TIPS, Channel.ADS));
    var player = server.addPlayer();

    dispatcher.execute("toggle-ads", new Source(player));

    assertThat(plain(player.nextComponentMessage())).isEqualTo("[Ads]: Ads are now off");
    assertThat(preferences.read(player).hears(Channel.ADS)).isFalse();
  }

  @Test
  void registersOnlyAnnouncedChannels() {
    var commands = new ToggleCommands(preferences, Set.of(Channel.TIPS));

    assertThat(commands.nodes()).extracting(CommandNode::getName).containsExactly("toggle-tips");
    assertThat(new ToggleCommands(preferences, Set.of(Channel.TIPS, Channel.ADS)).nodes())
        .extracting(CommandNode::getName)
        .containsExactly("toggle-tips", "toggle-ads");
  }

  @Test
  void isForPlayersOnly() {
    var dispatcher = dispatcher(Set.of(Channel.TIPS));
    var console = new Source(server.getConsoleSender());

    assertThatThrownBy(() -> dispatcher.execute("toggle-tips", console))
        .isInstanceOf(CommandSyntaxException.class);
  }

  private CommandDispatcher<CommandSourceStack> dispatcher(Set<Channel> channels) {
    var dispatcher = new CommandDispatcher<CommandSourceStack>();
    new ToggleCommands(preferences, channels).nodes().forEach(dispatcher.getRoot()::addChild);
    return dispatcher;
  }

  private static String plain(@Nullable Component message) {
    return PlainTextComponentSerializer.plainText()
        .serialize(requireNonNull(message, "no message was sent"));
  }

  /** The minimum command source Brigadier needs: who ran the command. */
  private record Source(CommandSender sender) implements CommandSourceStack {

    @Override
    public Location getLocation() {
      if (sender instanceof Player player) {
        return requireNonNull(player.getLocation());
      }
      throw new UnsupportedOperationException("the console has no location");
    }

    @Override
    public CommandSender getSender() {
      return sender;
    }

    @Override
    public Entity getExecutor() {
      if (sender instanceof Player player) {
        return player;
      }
      throw new UnsupportedOperationException("the console is not an entity");
    }

    @Override
    public Player getPlayerOrThrow() {
      return (Player) sender;
    }

    @Override
    public Entity getEntityOrThrow() {
      return getExecutor();
    }

    @Override
    public CommandSourceStack withLocation(Location location) {
      throw new UnsupportedOperationException();
    }

    @Override
    public CommandSourceStack withExecutor(Entity executor) {
      throw new UnsupportedOperationException();
    }
  }
}
