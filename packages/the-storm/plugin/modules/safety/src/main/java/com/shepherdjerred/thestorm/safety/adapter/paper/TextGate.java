package com.shepherdjerred.thestorm.safety.adapter.paper;

import static java.util.Collections.synchronizedMap;

import com.mojang.brigadier.StringReader;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import com.shepherdjerred.thestorm.core.safety.ContentPublication;
import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.app.SafetyService;
import com.shepherdjerred.thestorm.safety.domain.CommandContent;
import com.shepherdjerred.thestorm.safety.domain.ContentRules;
import io.papermc.paper.command.brigadier.MessageComponentSerializer;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.chat.SignedMessage;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.command.CommandException;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.jspecify.annotations.Nullable;

/** Captures every native chat and player command path, including namespaced command aliases. */
public final class TextGate implements Listener {
  /** How much of a refused command its reply quotes before the error, as Minecraft does. */
  private static final int CONTEXT_WIDTH = 10;

  private static final Set<String> LIVE_COMMAND_SURFACES = Set.of("chat", "message");

  private record InFlightCommand(ContentSubmission submission, String shown, boolean screened) {}

  private final ModuleContext context;
  private final SafetyService safety;
  private final ManagedGameplay flags;
  private final java.util.function.Consumer<SignedMessage> deleteSignedMessage;
  private final ContentAdmission admission;
  private final Set<UUID> replay = new HashSet<>();
  private final Map<AsyncChatEvent, ContentSubmission> inFlightChats =
      synchronizedMap(new IdentityHashMap<>());
  private final Map<PlayerCommandPreprocessEvent, InFlightCommand> inFlightCommands =
      synchronizedMap(new IdentityHashMap<>());

  public TextGate(ModuleContext context, SafetyService safety, ManagedGameplay flags) {
    this(context, safety, flags, context.plugin().getServer()::deleteMessage);
  }

  TextGate(
      ModuleContext context,
      SafetyService safety,
      ManagedGameplay flags,
      java.util.function.Consumer<SignedMessage> deleteSignedMessage) {
    this.context = context;
    this.safety = safety;
    this.flags = flags;
    this.deleteSignedMessage = deleteSignedMessage;
    this.admission = new ContentAdmission(context, safety);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer().getUniqueId();
    var _ =
        flags
            .prime(ManagedGameplay.ASYNC_CHAT_MODERATION, player, true, this::warnAsyncRollout)
            .exceptionally(failure -> {
              context.logger().error("Async chat rollout check failed for {}", player, failure);
              return true;
            });
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void chat(AsyncChatEvent event) {
    var player = event.getPlayer();
    if (!asyncChatEnabled(player.getUniqueId())) {
      legacyChat(event);
      return;
    }
    var message = event.message();
    var text = PlainTextComponentSerializer.plainText().serialize(message);
    var components = GsonComponentSerializer.gson().serialize(message);
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                "chat", safety.audience(player.getUniqueId(), text), text, components, ""));
    if (event.isCancelled()) {
      admission.observe(submission, "chat-already-cancelled");
      return;
    }
    var screened = contentSafetyEnabled(player.getUniqueId());
    var instant = safety.instantBlock(submission, screened);
    if (instant.isPresent()) {
      var block = instant.orElseThrow();
      event.setCancelled(true);
      denyStageOne(player, submission, block);
      return;
    }
    ContentPublication.beginEvent(
        event, new ContentPublication.Context(Optional.of(submission.id()), screened));
    inFlightChats.put(event, submission);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void chatMonitor(AsyncChatEvent event) {
    var _ = ContentPublication.endEvent(event);
    var submission = inFlightChats.remove(event);
    if (submission == null) return;
    if (event.isCancelled()) {
      admission.observe(submission, "denied-by-chat");
      return;
    }
    safety.recordRecentWindow(submission);
    runStageTwo(event.getPlayer(), submission, event.signedMessage());
  }

  private void legacyChat(AsyncChatEvent event) {
    var previouslyCancelled = event.isCancelled();
    event.setCancelled(true);
    var player = event.getPlayer();
    var message = event.message();
    var text = PlainTextComponentSerializer.plainText().serialize(message);
    var components = GsonComponentSerializer.gson().serialize(message);
    context
        .scheduler()
        .mainThread()
        .execute(() -> {
          var submission =
              admission.submission(
                  player,
                  new ContentAdmission.Draft(
                      "chat", safety.audience(player.getUniqueId(), text), text, components, ""));
          if (previouslyCancelled) {
            admission.observe(submission, "chat-already-cancelled");
            return;
          }
          admission.publish(
              player,
              submission,
              () -> {
                if (!safety.audience(player.getUniqueId(), text).equals(submission.audience()))
                  return "stale-audience";
                var approved = new ApprovedChatEvent(player, message, submission.id());
                context.plugin().getServer().getPluginManager().callEvent(approved);
                return approved.delivered() ? "delivered" : "denied-by-chat";
              });
        });
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void command(PlayerCommandPreprocessEvent event) {
    var player = event.getPlayer();
    if (replay.remove(player.getUniqueId())) return;
    var raw = event.getMessage();
    var content = CommandContent.parse(raw);
    var shown = content.secret() ? content.text() : raw;
    if (event.isCancelled()) {
      logCommand(player, shown, "cancelled");
      admission.observe(
          admission.submission(
              player, new ContentAdmission.Draft("command", "server", raw, "", "")),
          "command-already-cancelled");
      return;
    }
    if (!content.screen()) {
      observeUnscreenedCommand(player, raw, content, shown);
      return;
    }
    if (LIVE_COMMAND_SURFACES.contains(content.surface())
        && asyncChatEnabled(player.getUniqueId())) {
      liveCommand(event, content, shown);
      return;
    }
    pregateCommand(event, content, shown);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void commandMonitor(PlayerCommandPreprocessEvent event) {
    var inFlight = inFlightCommands.remove(event);
    if (inFlight == null) return;
    var player = event.getPlayer();
    var submission = inFlight.submission();
    if (event.isCancelled()) {
      logCommand(player, inFlight.shown(), "denied-by-command-listener");
      admission.observe(submission, "denied-by-command-listener");
      return;
    }
    var commandContext =
        ContentPublication.beginCommand(
            player.getUniqueId(),
            new ContentPublication.Context(Optional.of(submission.id()), inFlight.screened()));
    context
        .scheduler()
        .mainThread()
        .execute(() -> completeLiveCommand(player, inFlight, commandContext));
  }

  private void observeUnscreenedCommand(
      Player player, String raw, CommandContent content, String shown) {
    logCommand(player, shown, "attempt");
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                "command", "server", content.secret() ? content.text() : raw, "", ""));
    var _ =
        safety
            .observe(submission, "command-attempt")
            .exceptionally(failure -> {
              context.logger().error("Command audit failed for {}", submission.id(), failure);
              return null;
            });
  }

  private void liveCommand(
      PlayerCommandPreprocessEvent event, CommandContent content, String shown) {
    var player = event.getPlayer();
    var routed = safety.command(player.getUniqueId(), event.getMessage());
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                content.surface(),
                safety.audience(player.getUniqueId(), routed),
                content.text(),
                "",
                routed));
    var screened = contentSafetyEnabled(player.getUniqueId());
    var instant = safety.instantBlock(submission, screened);
    if (instant.isPresent()) {
      var block = instant.orElseThrow();
      event.setCancelled(true);
      logCommand(player, shown, "block");
      denyStageOne(player, submission, block);
      return;
    }
    inFlightCommands.put(event, new InFlightCommand(submission, shown, screened));
  }

  private void completeLiveCommand(
      Player player, InFlightCommand inFlight, ContentPublication.CommandContext commandContext) {
    ContentPublication.endCommand(player.getUniqueId(), commandContext);
    var submission = inFlight.submission();
    if (commandContext.rejected()) {
      logCommand(player, inFlight.shown(), "denied-by-chat");
      admission.observe(submission, "denied-by-chat");
      return;
    }
    logCommand(player, inFlight.shown(), "command-dispatched");
    safety.recordRecentWindow(submission);
    runStageTwo(player, submission, null);
  }

  private void pregateCommand(
      PlayerCommandPreprocessEvent event, CommandContent content, String shown) {
    var player = event.getPlayer();
    event.setCancelled(true);
    var routed = safety.command(player.getUniqueId(), event.getMessage());
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                content.surface(),
                safety.audience(player.getUniqueId(), routed),
                content.text(),
                "",
                routed));
    admission.publish(
        player,
        submission,
        () -> {
          if (!safety.audience(player.getUniqueId(), routed).equals(submission.audience())) {
            logCommand(player, shown, "stale-audience");
            return "stale-audience";
          }
          replay.add(player.getUniqueId());
          try {
            var approved = new PlayerCommandPreprocessEvent(player, routed);
            context.plugin().getServer().getPluginManager().callEvent(approved);
            if (approved.isCancelled()) {
              logCommand(player, shown, "denied-by-command-listener");
              return "denied-by-command-listener";
            }
            var outcome = dispatch(player, approved.getMessage().substring(1));
            logCommand(player, shown, outcome);
            return outcome;
          } finally {
            replay.remove(player.getUniqueId());
          }
        });
  }

  private void denyStageOne(
      Player player, ContentSubmission submission, ContentRules.InstantBlock block) {
    player.sendMessage(
        Component.text(
            "This was not published ("
                + block.category()
                + "). "
                + block.reason()
                + " Reference "
                + submission.id()));
    var _ =
        safety
            .recordInstantBlock(submission, block)
            .exceptionally(failure -> {
              context
                  .logger()
                  .error("Stage-1 block persistence failed for {}", submission.id(), failure);
              return null;
            });
  }

  private void runStageTwo(
      Player player, ContentSubmission submission, @Nullable SignedMessage signedMessage) {
    var _ =
        safety
            .checkDelivered(submission)
            .whenCompleteAsync(
                (review, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Post-publication content screening failed for {}",
                            submission.id(),
                            failure);
                    admission.record(submission.id(), "post-check-unavailable");
                    return;
                  }
                  if (review.allowed()) {
                    admission.record(submission.id(), "delivered-optimistic");
                    return;
                  }
                  retractDelivered(player, submission, review, signedMessage);
                },
                context.scheduler().mainThread());
  }

  private void retractDelivered(
      Player player,
      ContentSubmission submission,
      ContentReview review,
      @Nullable SignedMessage signedMessage) {
    var deletedSigned = false;
    if (signedMessage != null && signedMessage.canDelete()) {
      deleteSignedMessage.accept(signedMessage);
      deletedSigned = true;
    }
    try {
      safety.retract(submission.id());
    } catch (RuntimeException error) {
      context.logger().error("Chat relay retraction failed for {}", submission.id(), error);
    }
    if (player.isOnline()) {
      player.sendMessage(
          Component.text(
              "Your recent message was removed ("
                  + review.category()
                  + "). "
                  + review.reason()
                  + " Reference "
                  + submission.id()));
    }
    if (review.category().equals("advertising")
        && review.decision().equals("block")
        && review.confidence() >= .98) {
      admission.record(submission.id(), "advertising-warned");
    }
    admission.record(
        submission.id(),
        deletedSigned ? "deleted-retroactively" : "flagged-unsigned-retroactively");
  }

  private boolean asyncChatEnabled(UUID player) {
    return flags.nonblockingEnabled(
        ManagedGameplay.ASYNC_CHAT_MODERATION, player, true, this::warnAsyncRollout);
  }

  private boolean contentSafetyEnabled(UUID player) {
    return flags.nonblockingEnabled(
        ManagedGameplay.CONTENT_SAFETY, player, false, this::warnSafetyRollout);
  }

  private void warnAsyncRollout(Throwable failure) {
    context
        .logger()
        .warn("Async chat moderation rollout unavailable; retaining enabled default", failure);
  }

  private void warnSafetyRollout(Throwable failure) {
    context
        .logger()
        .warn(
            "Safety rollout provider unavailable; retaining unscreened legacy enforcement",
            failure);
  }

  private void logCommand(Player player, String text, String outcome) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(player)) return;
    var at = player.getLocation();
    if (at.getWorld() == null) return;
    context.logger().info("{}", PlayLog.command(player.getName(), at, text, outcome));
  }

  /**
   * Runs an approved command as its sender. Paper's {@code dispatchCommand} returns false for a
   * command that is unknown or that the player may not use, and throws for invalid arguments,
   * without telling the player; the typed command it replaces reports both.
   */
  private String dispatch(Player player, String command) {
    try {
      if (context.plugin().getServer().dispatchCommand(player, command))
        return "command-dispatched";
      refuse(
          player,
          command,
          CommandSyntaxException.BUILT_IN_EXCEPTIONS
              .dispatcherUnknownCommand()
              .createWithContext(new StringReader(command)));
      return "command-rejected";
    } catch (CommandException failure) {
      if (!(failure.getCause() instanceof CommandSyntaxException syntax)) throw failure;
      refuse(player, command, syntax);
      return "command-rejected";
    }
  }

  /** Sends the reply Minecraft gives a typed command that does not parse. */
  private static void refuse(Player player, String command, CommandSyntaxException failure) {
    var reply =
        Component.text()
            .color(NamedTextColor.RED)
            .append(MessageComponentSerializer.message().deserialize(failure.getRawMessage()));
    var input = failure.getInput();
    if (input != null && failure.getCursor() >= 0) {
      var cursor = Math.min(input.length(), failure.getCursor());
      var where =
          Component.text()
              .color(NamedTextColor.GRAY)
              .clickEvent(ClickEvent.suggestCommand("/" + command));
      if (cursor > CONTEXT_WIDTH) where.append(Component.text("..."));
      where.append(Component.text(input.substring(Math.max(0, cursor - CONTEXT_WIDTH), cursor)));
      if (cursor < input.length())
        where.append(
            Component.text(input.substring(cursor), NamedTextColor.RED, TextDecoration.UNDERLINED));
      where.append(
          Component.translatable(
              "command.context.here", NamedTextColor.RED, TextDecoration.ITALIC));
      reply.append(Component.newline()).append(where);
    }
    player.sendMessage(reply.build());
  }
}
