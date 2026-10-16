package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.safety.domain.CommandContent;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;

/** Captures every native chat and player command path, including namespaced command aliases. */
public final class TextGate implements Listener {
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
            return context
                    .plugin()
                    .getServer()
                    .dispatchCommand(player, approved.getMessage().substring(1))
                ? "command-dispatched"
                : "command-rejected";
          } finally {
            replay.remove(player.getUniqueId());
          }
        });
  }
}
