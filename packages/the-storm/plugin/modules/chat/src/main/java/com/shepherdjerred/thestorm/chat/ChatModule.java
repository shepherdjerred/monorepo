package com.shepherdjerred.thestorm.chat;

import com.shepherdjerred.thestorm.chat.adapter.db.JooqChatStore;
import com.shepherdjerred.thestorm.chat.adapter.paper.ChatCommands;
import com.shepherdjerred.thestorm.chat.adapter.paper.ChatListener;
import com.shepherdjerred.thestorm.chat.adapter.paper.MuteCommands;
import com.shepherdjerred.thestorm.chat.adapter.paper.PaperChatOutput;
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

/**
 * Chat channels (Global, War, Staff, Town, Nation), ignores and staff mutes; replaces VentureChat.
 * Publishes {@link GlobalChat} for bridges, and {@link ChannelRegistry} and {@link PrefixRegistry}
 * for the towns and tracks modules.
 */
public final class ChatModule implements StormModule {

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
    // Nothing waits on the load; a failure is logged and chat runs on what it has in memory.
    var _ =
        service
            .load()
            .whenComplete(
                (loaded, error) -> {
                  if (error != null) {
                    logger.error("Loading chat state failed", error);
                  }
                });

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
    var muteCommands = new MuteCommands(service, server);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              chatCommands.register(event.registrar());
              muteCommands.register(event.registrar());
            });
  }
}
