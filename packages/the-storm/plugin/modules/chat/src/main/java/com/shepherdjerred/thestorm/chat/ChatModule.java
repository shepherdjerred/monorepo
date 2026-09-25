package com.shepherdjerred.thestorm.chat;

import com.shepherdjerred.thestorm.chat.adapter.db.JooqChatStore;
import com.shepherdjerred.thestorm.chat.adapter.paper.ChatCommands;
import com.shepherdjerred.thestorm.chat.adapter.paper.ChatListener;
import com.shepherdjerred.thestorm.chat.adapter.paper.MuteCommands;
import com.shepherdjerred.thestorm.chat.adapter.paper.PaperChatOutput;
import com.shepherdjerred.thestorm.chat.adapter.paper.PrivateCommands;
import com.shepherdjerred.thestorm.chat.app.ChannelRegistry;
import com.shepherdjerred.thestorm.chat.app.ChatConfig;
import com.shepherdjerred.thestorm.chat.app.ChatExtensions;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.GlobalChatHub;
import com.shepherdjerred.thestorm.chat.app.PrefixRegistry;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Chat channels (Global, War, Staff, Town, Nation), private messages, emotes, ignores and staff
 * mutes; replaces VentureChat. Publishes {@link GlobalChat} for bridges, and {@link
 * ChannelRegistry} and {@link PrefixRegistry} for the towns and tracks modules.
 */
public final class ChatModule implements StormModule {

  /** The longest enable waits for stored chat state. */
  static final Duration LOAD_TIMEOUT = Duration.ofSeconds(30);

  @Override
  public String id() {
    return "chat";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("chat.yml", ChatConfig.class);
    var logger = context.logger();
    context.database().migrate(id(), getClass().getClassLoader());

    var store =
        new JooqChatStore(
            context.database(), error -> logger.error("Saving chat state failed", error));
    var extensions = new ChatExtensions();
    var service = new ChatService(config, store, context.time(), extensions);
    awaitLoad(service);

    var server = context.plugin().getServer();
    var output = new PaperChatOutput(server, service);
    var hub =
        new GlobalChatHub(
            service,
            output,
            context.time(),
            error -> logger.error("A Global chat listener failed", error));

    context.services().provide(GlobalChat.class, hub);
    context.services().provide(ChannelRegistry.class, extensions);
    context.services().provide(PrefixRegistry.class, extensions);

    server.getPluginManager().registerEvents(new ChatListener(service, hub), context.plugin());
    var chatCommands = new ChatCommands(service, hub, output);
    var privateCommands = new PrivateCommands(service, output, server);
    var muteCommands = new MuteCommands(service, server);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              chatCommands.register(event.registrar());
              privateCommands.register(event.registrar());
              muteCommands.register(event.registrar());
            });
  }

  /**
   * Waits for stored mutes, ignores and focus before chat starts, so it never runs on empty state
   * (a muted player could otherwise talk). Enable runs before any player can join, so the bounded
   * wait blocks nobody; a failed or slow load stops the module.
   */
  private static void awaitLoad(ChatService service) {
    try {
      service.load().get(LOAD_TIMEOUT.toSeconds(), TimeUnit.SECONDS);
    } catch (ExecutionException e) {
      throw new IllegalStateException("Loading chat state failed; chat will not start", e);
    } catch (TimeoutException e) {
      throw new IllegalStateException(
          "Loading chat state took longer than " + LOAD_TIMEOUT + "; chat will not start", e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while loading chat state", e);
    }
  }
}
