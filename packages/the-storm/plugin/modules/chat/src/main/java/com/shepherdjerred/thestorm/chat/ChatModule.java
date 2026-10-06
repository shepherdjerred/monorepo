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
import org.bukkit.entity.Player;

/**
 * Chat channels (Global, War, Staff, Town), private messages, emotes, ignores and staff mutes;
 * replaces VentureChat. Publishes {@link GlobalChat} for bridges, and {@link ChannelRegistry} and
 * {@link PrefixRegistry} for the towns and tracks modules.
 */
public final class ChatModule implements StormModule {
  private com.shepherdjerred.thestorm.core.schedule.@org.jspecify.annotations.Nullable Cancellable
      identityRefresh;

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
    var identities =
        new com.shepherdjerred.thestorm.chat.app.IdentityService(
            new com.shepherdjerred.thestorm.chat.adapter.db.JooqIdentityStore(context.database()));
    service.identities(identities::effective);
    service.storedIdentities(identities::identity);
    context
        .services()
        .provide(com.shepherdjerred.thestorm.chat.app.IdentityService.class, identities);
    context
        .services()
        .provide(
            com.shepherdjerred.thestorm.chat.app.MessagingPolicy.class,
            new com.shepherdjerred.thestorm.chat.app.MessagingPolicy() {
              @Override
              public com.shepherdjerred.thestorm.core.result.Result<String, String> letter(
                  Attempt attempt) {
                return service.letter(attempt);
              }

              @Override
              public void delivered(java.util.UUID sender, String text) {
                service.letterDelivered(sender, text);
              }
            });
    var identityCommands =
        new com.shepherdjerred.thestorm.chat.adapter.paper.IdentityCommands(context, identities);
    context.services().provide(ChatService.class, service);
    var server = context.plugin().getServer();
    var output = new PaperChatOutput(context, service);
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
    server.getPluginManager().registerEvents(identityCommands, context.plugin());
    identityRefresh =
        context
            .scheduler()
            .repeatOnMainThread(
                java.time.Duration.ofSeconds(5),
                java.time.Duration.ofSeconds(5),
                () -> {
                  if (identities.ready())
                    server.getOnlinePlayers().forEach(identityCommands::apply);
                });
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
              identityCommands.register(event.registrar());
            });
    var _ =
        service
            .load()
            .thenCompose(ignored -> identities.load())
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    logger.error("Loading chat state failed; stopping the server", failure);
                    server.shutdown();
                    return;
                  }
                  server.getOnlinePlayers().forEach(Player::updateCommands);
                  server.getOnlinePlayers().forEach(identityCommands::apply);
                },
                context.scheduler().mainThread());
  }

  @Override
  public void disable() {
    if (identityRefresh != null) identityRefresh.cancel();
  }
}
