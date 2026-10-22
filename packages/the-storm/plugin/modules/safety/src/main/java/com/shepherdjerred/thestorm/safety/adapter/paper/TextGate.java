package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.mojang.brigadier.StringReader;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.safety.domain.CommandContent;
import io.papermc.paper.command.brigadier.MessageComponentSerializer;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
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

/** Captures every native chat and player command path, including namespaced command aliases. */
public final class TextGate implements Listener {
  /** How much of a refused command its reply quotes before the error, as Minecraft does. */
  private static final int CONTEXT_WIDTH = 10;

  private final ModuleContext context;
  private final ContentSafety safety;
  private final ContentAdmission admission;
  private final Set<UUID> replay = new HashSet<>();

  public TextGate(ModuleContext context, ContentSafety safety) {
    this.context = context;
    this.safety = safety;
    this.admission = new ContentAdmission(context, safety);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void chat(AsyncChatEvent event) {
    var previouslyCancelled = event.isCancelled();
    event.setCancelled(true);
    var player = event.getPlayer();
    var message = event.message();
    var text = PlainTextComponentSerializer.plainText().serialize(message);
    var components = GsonComponentSerializer.gson().serialize(message);
    // Audience/membership providers own main-thread state; capture it after leaving the chat
    // thread.
    context
        .scheduler()
        .mainThread()
        .execute(
            () -> {
              var submission =
                  admission.submission(
                      player,
                      new ContentAdmission.Draft(
                          "chat",
                          safety.audience(player.getUniqueId(), text),
                          text,
                          components,
                          ""));
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
    if (event.isCancelled()) {
      admission.observe(
          admission.submission(
              player, new ContentAdmission.Draft("command", "server", raw, "", "")),
          "command-already-cancelled");
      return;
    }
    if (!content.screen()) {
      var submission =
          admission.submission(
              player,
              new ContentAdmission.Draft(
                  "command", "server", content.secret() ? content.text() : raw, "", ""));
      var _ =
          safety
              .observe(submission, "command-attempt")
              .exceptionally(
                  failure -> {
                    context.logger().error("Command audit failed for {}", submission.id(), failure);
                    return null;
                  });
      return;
    }
    event.setCancelled(true);
    var routed = safety.command(player.getUniqueId(), raw);
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
          if (!safety.audience(player.getUniqueId(), routed).equals(submission.audience()))
            return "stale-audience";
          replay.add(player.getUniqueId());
          try {
            var approved = new PlayerCommandPreprocessEvent(player, routed);
            context.plugin().getServer().getPluginManager().callEvent(approved);
            if (approved.isCancelled()) return "denied-by-command-listener";
            return dispatch(player, approved.getMessage().substring(1));
          } finally {
            replay.remove(player.getUniqueId());
          }
        });
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
