package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** A guide based on the sender's effective permissions and current rollout. */
final class StaffGuide {
  private record Flags(boolean identity, boolean staff) {}

  private final StaffCommands tools;

  StaffGuide(StaffCommands tools) {
    this.tools = tools;
  }

  void register(Commands commands) {
    commands.register(
        Commands.literal("help")
            .executes(
                command -> {
                  show(command.getSource().getSender(), "");
                  return 1;
                })
            .then(
                Commands.argument(
                        "command", com.mojang.brigadier.arguments.StringArgumentType.word())
                    .executes(
                        command -> {
                          show(
                              command.getSource().getSender(),
                              command.getArgument("command", String.class));
                          return 1;
                        }))
            .build(),
        "Show your command guide");
  }

  private void show(CommandSender sender, String requested) {
    var flags = tools.context.services().require(ManagedGameplay.class);
    var actor = sender instanceof Player player ? player.getUniqueId() : new UUID(0, 0);
    tools.complete(
        sender,
        flags
            .enabled(ManagedGameplay.IDENTITY, actor)
            .exceptionally(_ -> false)
            .thenCombine(
                flags.enabled(ManagedGameplay.STAFF, actor).exceptionally(_ -> false), Flags::new),
        enabled -> {
          var guide = guide(sender, enabled.identity(), enabled.staff());
          if (!requested.isEmpty()) {
            sender.sendMessage(
                Component.text(
                    guide.containsKey(requested)
                        ? "/" + guide.get(requested)
                        : "Use /help to see your commands."));
            return;
          }
          sender.sendMessage(
              Component.text(
                  "Commands: /"
                      + String.join(", /", guide.keySet())
                      + ". Use /help <command> for usage."));
        });
  }

  private Map<String, String> guide(CommandSender sender, boolean identity, boolean staff) {
    var guide = new TreeMap<String, String>();
    for (var name : java.util.List.of("spawn", "back", "warp", "rules", "afk"))
      add(guide, sender, name, name);
    for (var name : java.util.List.of("home", "sethome", "delhome", "homes"))
      add(guide, sender, name, "home");
    for (var name : java.util.List.of("tpa", "tpahere", "tpaccept", "tpdeny", "tptoggle"))
      add(guide, sender, name, "tpa");
    for (var name : java.util.List.of("setwarp", "delwarp", "kick", "history"))
      add(guide, sender, name, name);
    for (var name : java.util.List.of("ban", "tempban", "unban", "banlist"))
      add(guide, sender, name, "ban");
    guide.put(
        "mail",
        "mail [send <username> <text>|read <id>|reply <id> <text>|delete <id>|claim <reward-id> <choice>]");
    guide.put("msg", "msg <username> <text>");
    guide.put("r", "r <text>");
    guide.put("ignore", "ignore <username>");
    if (identity)
      for (var name : java.util.List.of("nick", "realname", "msgtoggle", "rtoggle"))
        add(guide, sender, name, name);
    if (staff) {
      guide.putAll(tools.guide(sender));
      add(guide, sender, "socialspy", "socialspy");
    }
    guide.put("help", "help [command]");
    return guide;
  }

  private static void add(
      Map<String, String> guide, CommandSender sender, String name, String permission) {
    if (sender.hasPermission("thestorm.essentials." + permission)) guide.put(name, name);
  }
}
