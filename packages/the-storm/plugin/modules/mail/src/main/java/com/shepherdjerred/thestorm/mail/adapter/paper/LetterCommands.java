package com.shepherdjerred.thestorm.mail.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.shepherdjerred.thestorm.chat.app.MessagingPolicy;
import com.shepherdjerred.thestorm.core.expansion.ExpansionSettings;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mail.app.Letters;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.inventory.Book;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import org.bukkit.entity.Player;

/** Player-authored text letters, read as books without issuing inventory items. */
public final class LetterCommands {
  private final ModuleContext context;
  private final Letters letters;
  private final Letters.Limits limits;

  public LetterCommands(ModuleContext context, Letters letters) {
    this.context = context;
    this.letters = letters;
    var settings = context.services().require(ExpansionSettings.class);
    limits =
        new Letters.Limits(
            settings.letterLength(), settings.letterIntervalSeconds(), settings.inboxLimit());
  }

  public void decorate(LiteralArgumentBuilder<CommandSourceStack> root) {
    root.then(
        literal("send")
            .then(
                argument("player", word())
                    .then(
                        argument("text", greedyString())
                            .executes(
                                command -> {
                                  var actor = (Player) command.getSource().getSender();
                                  gated(
                                      actor,
                                      () ->
                                          resolve(
                                              actor,
                                              command.getArgument("player", String.class),
                                              command.getArgument("text", String.class)));
                                  return 1;
                                }))));
    for (var action : java.util.List.of("read", "delete", "reply")) {
      var node =
          literal(action)
              .then(
                  argument("id", word())
                      .executes(
                          command -> {
                            var actor = (Player) command.getSource().getSender();
                            gated(
                                actor,
                                () -> open(actor, action, command.getArgument("id", String.class)));
                            return 1;
                          }));
      if ("reply".equals(action))
        node =
            literal(action)
                .then(
                    argument("id", word())
                        .then(
                            argument("text", greedyString())
                                .executes(
                                    command -> {
                                      var actor = (Player) command.getSource().getSender();
                                      gated(
                                          actor,
                                          () ->
                                              reply(
                                                  actor,
                                                  command.getArgument("id", String.class),
                                                  command.getArgument("text", String.class)));
                                      return 1;
                                    })));
      root.then(node);
    }
  }

  public void list(Player player) {
    gated(
        player,
        false,
        () ->
            complete(
                player,
                letters.inbox(player.getUniqueId()),
                inbox -> {
                  inbox.forEach(
                      letter ->
                          player.sendMessage(
                              Component.text(
                                      (letter.read() ? "[Letter] " : "[Unread letter] ")
                                          + letter.senderName()
                                          + " — "
                                          + letter.sentAt()
                                          + " ")
                                  .append(
                                      Component.text("[Read]")
                                          .clickEvent(
                                              ClickEvent.runCommand(
                                                  "/mail read " + letter.id())))));
                  if (inbox.isEmpty()) player.sendMessage(Component.text("You have no letters."));
                }));
  }

  public void unread(Player player) {
    gated(
        player,
        false,
        () ->
            complete(
                player,
                letters.inbox(player.getUniqueId()),
                inbox -> {
                  var count = inbox.stream().filter(letter -> !letter.read()).count();
                  if (count > 0)
                    player.sendMessage(
                        Component.text("You have " + count + " unread letters. /mail"));
                }));
  }

  private void resolve(Player actor, String name, String text) {
    complete(
        actor,
        context.services().require(PlayerDirectory.class).byName(name),
        known -> {
          if (known.isEmpty()) {
            actor.sendMessage(Component.text("No player with that username has joined."));
            return;
          }
          send(actor, known.orElseThrow().uuid(), text);
        });
  }

  private void send(Player actor, UUID recipient, String text) {
    var gameplay = context.services().require(ManagedGameplay.class);
    complete(
        actor,
        gameplay.enabled(ManagedGameplay.LETTERS, recipient),
        lettersEnabled -> {
          if (!lettersEnabled) {
            actor.sendMessage(Component.text("Letters are not available for that player."));
            return;
          }
          complete(
              actor,
              gameplay.enabled(ManagedGameplay.IDENTITY, recipient),
              identityEnabled -> send(actor, recipient, text, identityEnabled));
        });
  }

  private void send(Player actor, UUID recipient, String text, boolean recipientIdentityEnabled) {
    var policy =
        context
            .services()
            .require(MessagingPolicy.class)
            .letter(
                new MessagingPolicy.Attempt(
                    actor.getUniqueId(),
                    actor.getName(),
                    actor.hasPermission("thestorm.chat.staff"),
                    actor.hasPermission("thestorm.chat.bypass"),
                    recipient,
                    text,
                    new MessagingPolicy.LetterPolicy(
                        limits.maxLength(), recipientIdentityEnabled)));
    switch (policy) {
      case Result.Err<String, String>(var error) -> actor.sendMessage(Component.text(error));
      case Result.Ok<String, String>(var accepted) -> {
        var id =
            new UUID(
                (context.random().nextLong() & 0xffffffffffff0fffL) | 0x4000L,
                (context.random().nextLong() & 0x3fffffffffffffffL) | 0x8000000000000000L);
        var letter =
            new Letters.Letter(
                id,
                actor.getUniqueId(),
                actor.getName(),
                recipient,
                accepted,
                context.time().instant(),
                false);
        committed(
            actor,
            letters.send(letter, limits),
            result -> {
              switch (result) {
                case Result.Err<UUID, String>(var error) ->
                    actor.sendMessage(Component.text(error));
                case Result.Ok<UUID, String> _ -> {
                  context
                      .services()
                      .require(MessagingPolicy.class)
                      .delivered(letter.sender(), letter.text());
                  if (actor.isOnline()) actor.sendMessage(Component.text("Letter sent."));
                  var online = context.plugin().getServer().getPlayer(recipient);
                  if (online != null)
                    online.sendMessage(
                        Component.text("A letter from " + letter.senderName() + " arrived. /mail"));
                }
              }
            });
      }
    }
  }

  private void open(Player actor, String action, String rawId) {
    var id = id(actor, rawId);
    if (id.isEmpty()) return;
    if ("delete".equals(action)) {
      complete(
          actor,
          letters.delete(actor.getUniqueId(), id.orElseThrow()),
          removed ->
              actor.sendMessage(
                  Component.text(
                      removed ? "Letter deleted." : "That letter is not in your inbox.")));
      return;
    }
    complete(
        actor,
        letters.read(actor.getUniqueId(), id.orElseThrow(), context.time().instant()),
        found -> {
          if (found.isEmpty()) {
            actor.sendMessage(Component.text("That letter is not in your inbox."));
            return;
          }
          var letter = found.orElseThrow();
          var pages = new ArrayList<Component>();
          var text = letter.text();
          for (var start = 0; start < text.length(); ) {
            var remaining = text.codePointCount(start, text.length());
            var end = text.offsetByCodePoints(start, Math.min(200, remaining));
            pages.add(Component.text(text.substring(start, end)));
            start = end;
          }
          actor.openBook(
              Book.book(Component.text("Letter"), Component.text(letter.senderName()), pages));
        });
  }

  private void reply(Player actor, String rawId, String text) {
    var id = id(actor, rawId);
    if (id.isEmpty()) return;
    complete(
        actor,
        letters.find(actor.getUniqueId(), id.orElseThrow()),
        found -> {
          if (found.isEmpty())
            actor.sendMessage(Component.text("That letter is not in your inbox."));
          else send(actor, found.orElseThrow().sender(), text);
        });
  }

  private static Optional<UUID> id(Player player, String raw) {
    try {
      return Optional.of(UUID.fromString(raw));
    } catch (IllegalArgumentException invalid) {
      player.sendMessage(Component.text("Use a letter ID from /mail."));
      return Optional.empty();
    }
  }

  private void gated(Player player, Runnable action) {
    gated(player, true, action);
  }

  private void gated(Player player, boolean reportDisabled, Runnable action) {
    complete(
        player,
        context
            .services()
            .require(ManagedGameplay.class)
            .enabled(ManagedGameplay.LETTERS, player.getUniqueId()),
        enabled -> {
          if (enabled) action.run();
          else if (reportDisabled)
            player.sendMessage(Component.text("Letters are not enabled for you."));
        });
  }

  private <T> void complete(Player actor, CompletableFuture<T> future, Consumer<T> success) {
    committed(
        actor,
        future,
        value -> {
          if (actor.isOnline()) success.accept(value);
        });
  }

  private <T> void committed(Player actor, CompletableFuture<T> future, Consumer<T> success) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                context
                    .logger()
                    .error("Letter operation failed for {}", actor.getUniqueId(), failure);
                if (actor.isOnline())
                  actor.sendMessage(Component.text("Could not complete that letter request."));
                return;
              }
              success.accept(value);
            },
            context.scheduler().mainThread());
  }
}
