package com.shepherdjerred.thestorm.reset.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.shepherdjerred.thestorm.core.expansion.ExpansionSettings;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.reset.app.PlayerResetService;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;

/** The explicitly permission-gated, confirmed {@code /reset} command. */
public final class ResetCommands {

  public static final String PERMISSION = "thestorm.reset";

  private record Pending(UUID target, String input, Instant expires) {}

  private final ModuleContext context;
  private final PlayerResetService resets;
  private final PlayerDirectory players;
  private final ExpansionSettings settings;
  private final Map<String, Pending> pending = new HashMap<>();
  private final Permission permission =
      new Permission(PERMISSION, "Reset a player to first-join state", PermissionDefault.FALSE);

  public ResetCommands(ModuleContext context, PlayerResetService resets) {
    this.context = context;
    this.resets = resets;
    players = context.services().require(PlayerDirectory.class);
    settings = context.services().require(ExpansionSettings.class);
  }

  public void register(Commands commands) {
    context.plugin().getServer().getPluginManager().addPermission(permission);
    commands.register(
        literal("reset")
            .requires(source -> allowed(source.getSender()))
            .executes(command -> usage(command.getSource().getSender()))
            .then(
                argument("player", word())
                    .executes(
                        command ->
                            invoke(
                                command.getSource().getSender(),
                                command.getArgument("player", String.class))))
            .build(),
        "Reset a player to first-join state");
  }

  public void stop() {
    pending.clear();
    context.plugin().getServer().getPluginManager().removePermission(permission);
  }

  private int usage(CommandSender actor) {
    actor.sendMessage(Component.text("Usage: /reset <player>"));
    return 1;
  }

  private int invoke(CommandSender actor, String input) {
    var _ =
        players
            .byName(input)
            .whenCompleteAsync(
                (found, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not resolve reset target {}", input, failure);
                    actor.sendMessage(Component.text("Could not resolve that player."));
                    return;
                  }
                  if (found.isEmpty()) {
                    actor.sendMessage(Component.text("That player has not joined before."));
                    return;
                  }
                  confirm(actor, input, found.orElseThrow().uuid());
                },
                context.scheduler().mainThread());
    return 1;
  }

  private void confirm(CommandSender actor, String input, UUID target) {
    if (!allowed(actor)) {
      actor.sendMessage(Component.text("You do not have permission for that action."));
      return;
    }
    var key = actor instanceof Player player ? player.getUniqueId().toString() : "console";
    var now = context.time().instant();
    pending.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expires()));
    var previous = pending.remove(key);
    if (previous == null
        || !previous.input().equals(input)
        || !previous.target().equals(target)
        || !now.isBefore(previous.expires())) {
      pending.put(key, new Pending(target, input, now.plusSeconds(settings.confirmationSeconds())));
      actor.sendMessage(
          Component.text(
              "Repeat /reset "
                  + input
                  + " within "
                  + settings.confirmationSeconds()
                  + " seconds to permanently reset that player."));
      return;
    }
    var _ =
        resets
            .reset(target)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not reset player {}", target, failure);
                    actor.sendMessage(
                        Component.text(
                            "Reset failed; the player remains blocked. Retry the command."));
                  } else {
                    actor.sendMessage(Component.text("Reset complete for " + input + "."));
                  }
                },
                context.scheduler().mainThread());
  }

  private static boolean allowed(CommandSender actor) {
    return !(actor instanceof Player) || actor.hasPermission(PERMISSION);
  }
}
