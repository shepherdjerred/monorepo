package com.shepherdjerred.thestorm.discord;

import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.MessagingPolicy;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.core.expansion.ExpansionSettings;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.discord.adapter.db.JooqLinkStore;
import com.shepherdjerred.thestorm.discord.adapter.discord.JdaBridge;
import com.shepherdjerred.thestorm.discord.adapter.paper.DiscordMail;
import com.shepherdjerred.thestorm.discord.adapter.paper.LinkCommands;
import com.shepherdjerred.thestorm.discord.adapter.paper.PaperOnlinePlayers;
import com.shepherdjerred.thestorm.discord.adapter.paper.SealedPlayers;
import com.shepherdjerred.thestorm.discord.adapter.paper.ServerEventsListener;
import com.shepherdjerred.thestorm.discord.adapter.paper.TownMilestonePosts;
import com.shepherdjerred.thestorm.discord.adapter.paper.VanillaPlainText;
import com.shepherdjerred.thestorm.discord.app.DiscordConfig;
import com.shepherdjerred.thestorm.discord.app.DiscordReadCommands;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.app.Links;
import com.shepherdjerred.thestorm.discord.domain.DiscordCredentials;
import com.shepherdjerred.thestorm.discord.domain.PendingLinks;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.PlayerLeaderboard;
import com.shepherdjerred.thestorm.mail.app.Letters;
import com.shepherdjerred.thestorm.towns.app.TownMilestones;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The Discord bridge (replaces DiscordSRV): Global chat both ways, join, leave, death and
 * advancement posts, wake and sleep posts, a live status line, the {@code /list}, {@code /status},
 * {@code /baltop}, {@code /towns} and {@code /mail} commands plus any a module adds, and town
 * foundings and claim milestones. Needs the chat, economy, mail and towns modules. Other modules
 * post through the {@link DiscordRelay} service: tickets, quest and skill milestones, and Search
 * and Destroy and Mob Arena lobbies and results (lobby posts may ping the roles in {@code
 * lobbyPing}).
 *
 * <p>Players link their Discord account with {@code /link} in Discord and {@code /discord link
 * <code>} in game, and may then ask for their own minigame results by direct message.
 *
 * <p>The bot token and channel id come from environment variables named in {@code discord.yml};
 * without them the module refuses to start.
 */
public final class DiscordModule implements StormModule {

  /** How long a {@code /link} code can be typed in game. */
  static final Duration LINK_CODE_LIFETIME = Duration.ofMinutes(10);

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

    context.database().migrate(id(), getClass().getClassLoader());
    var links =
        new Links(
            new JooqLinkStore(context.database()),
            new PendingLinks(LINK_CODE_LIFETIME),
            context.time(),
            context.random());
    var _ =
        links
            .load()
            .whenComplete(
                (loaded, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not load Discord links", failure);
                  }
                });
    var bridge = new JdaBridge(context.logger());
    var relay =
        new DiscordRelay(
            config,
            bridge,
            new DiscordRelay.Game(
                chat, context.scheduler(), new PaperOnlinePlayers(server), context.time()),
            links);
    context.services().provide(DiscordRelay.class, relay);
    var sealed = context.services().require(SealedWorlds.class);
    // Chat lines arrive on the async chat thread; the filter answers from its own main-thread map.
    var sealedPlayers = SealedPlayers.track(server, sealed);
    server.getPluginManager().registerEvents(sealedPlayers, context.plugin());
    var subscription = chat.subscribe(sealedPlayers.guarding(relay::onChatLine));
    var text = new VanillaPlainText(server.getClass().getClassLoader());
    var commands =
        new DiscordReadCommands(
            new DiscordReadCommands.Ports(
                context.services().require(PlayerLeaderboard.class),
                context.services().require(CrystalFormatter.class),
                context.services().require(TownRead.class),
                context.scheduler()),
            relay,
            context.logger());
    server
        .getPluginManager()
        .registerEvents(new ServerEventsListener(relay, text, sealed), context.plugin());
    var towns =
        context
            .services()
            .require(TownMilestones.class)
            .subscribe(new TownMilestonePosts(relay, server, context.logger())::accept);
    var linkCommands = new LinkCommands(links, context.scheduler().mainThread(), context.logger());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> linkCommands.register(event.registrar()));
    var settings = context.services().require(ExpansionSettings.class);
    relay.addCommand(
        new DiscordMail(
                new DiscordMail.Ports(
                    context.services().require(Letters.class),
                    new Letters.Limits(
                        settings.letterLength(),
                        settings.letterIntervalSeconds(),
                        settings.inboxLimit()),
                    context.services().require(ManagedGameplay.class),
                    context.services().require(MessagingPolicy.class),
                    context.services().require(PlayerDirectory.class)),
                new DiscordMail.Side(
                    server,
                    context.scheduler().mainThread(),
                    context.time(),
                    context.random(),
                    context.logger()))
            .command());
    bridge.start(credentials, relay, commands, links);
    running = new Running(bridge, relay, subscription, towns);
  }

  @Override
  public void disable() {
    var current = running;
    running = null;
    if (current != null) {
      // Discord stops reaching the game first; then the goodbye; then the connection closes.
      current.relay().stopRelaying();
      current.subscription().cancel();
      current.towns().close();
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

  private record Running(
      JdaBridge bridge,
      DiscordRelay relay,
      Subscription subscription,
      TownMilestones.Subscription towns) {}
}
