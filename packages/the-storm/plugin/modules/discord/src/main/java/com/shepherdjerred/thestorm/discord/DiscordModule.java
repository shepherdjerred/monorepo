package com.shepherdjerred.thestorm.discord;

import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.discord.adapter.discord.JdaBridge;
import com.shepherdjerred.thestorm.discord.adapter.paper.PaperOnlinePlayers;
import com.shepherdjerred.thestorm.discord.adapter.paper.ServerEventsListener;
import com.shepherdjerred.thestorm.discord.app.DiscordConfig;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.domain.DiscordCredentials;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The Discord bridge (replaces DiscordSRV): Global chat both ways, join, leave, death and
 * advancement posts, wake and sleep posts, and {@code /list}. Needs the chat module.
 *
 * <p>The bot token and channel id come from environment variables named in {@code discord.yml};
 * without them the module refuses to start.
 */
public final class DiscordModule implements StormModule {

  private final Function<String, Optional<String>> environment;
  private @Nullable Running running;

  /** Reads credentials from the process environment. */
  public DiscordModule() {
    this(name -> Optional.ofNullable(System.getenv(name)));
  }

  /** Reads credentials through {@code environment}, for tests. */
  public DiscordModule(Function<String, Optional<String>> environment) {
    this.environment = environment;
  }

  @Override
  public String id() {
    return "discord";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("discord.yml", DiscordConfig.class);
    var credentials = credentials(config, environment);
    var chat = context.services().require(GlobalChat.class);
    var server = context.plugin().getServer();

    var bridge = new JdaBridge(context.logger());
    var relay =
        new DiscordRelay(
            config,
            bridge,
            new DiscordRelay.Game(chat, context.scheduler(), new PaperOnlinePlayers(server)));
    var subscription = chat.subscribe(relay::onChatLine);
    server.getPluginManager().registerEvents(new ServerEventsListener(relay), context.plugin());
    bridge.start(credentials, relay);
    running = new Running(bridge, relay, subscription);
  }

  @Override
  public void disable() {
    var current = running;
    running = null;
    if (current != null) {
      // Discord stops reaching the game first; then the goodbye; then the connection closes.
      current.relay().stopRelaying();
      current.subscription().cancel();
      current.bridge().stop(current.relay().stopMessage());
    }
  }

  /** The credentials, or a startup failure naming every missing variable (never a value). */
  static DiscordCredentials credentials(
      DiscordConfig config, Function<String, Optional<String>> environment) {
    return switch (DiscordCredentials.resolve(
        config.tokenEnv(), config.channelEnv(), environment)) {
      case Result.Ok<DiscordCredentials, List<String>>(var value) -> value;
      case Result.Err<DiscordCredentials, List<String>>(var problems) ->
          throw new IllegalStateException(
              "The discord module cannot start: "
                  + String.join("; ", problems)
                  + ". Wire the secrets or switch the module off in config.yml.");
    };
  }

  private record Running(JdaBridge bridge, DiscordRelay relay, Subscription subscription) {}
}
