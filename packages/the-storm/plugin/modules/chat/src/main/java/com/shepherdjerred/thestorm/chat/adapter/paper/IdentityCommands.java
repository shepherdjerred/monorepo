package com.shepherdjerred.thestorm.chat.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.shepherdjerred.thestorm.chat.app.IdentityService;
import com.shepherdjerred.thestorm.chat.domain.Identity;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Optional;
import java.util.UUID;
import java.util.function.UnaryOperator;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Nicknames, private-message preferences and staff SocialSpy. */
public final class IdentityCommands implements Listener {
  private final ModuleContext context;
  private final IdentityService identities;

  public IdentityCommands(ModuleContext context, IdentityService identities) {
    this.context = context;
    this.identities = identities;
  }

  private void permissions() {
    for (var permission :
        java.util.List.of("socialspy", "nick.others", "nick", "realname", "msgtoggle", "rtoggle")) {
      var name = "thestorm.essentials." + permission;
      if (context.plugin().getServer().getPluginManager().getPermission(name) == null)
        context
            .plugin()
            .getServer()
            .getPluginManager()
            .addPermission(
                new org.bukkit.permissions.Permission(
                    name,
                    ("socialspy".equals(permission) || permission.endsWith(".others"))
                        ? org.bukkit.permissions.PermissionDefault.OP
                        : org.bukkit.permissions.PermissionDefault.TRUE));
    }
  }

  public void register(Commands commands) {
    permissions();
    commands.register(
        literal("nick")
            .requires(
                source ->
                    identities.ready()
                        && source.getSender() instanceof Player
                        && source.getSender().hasPermission("thestorm.essentials.nick"))
            .then(
                argument("arguments", greedyString())
                    .executes(
                        command -> {
                          var player = (Player) command.getSource().getSender();
                          gated(
                              player,
                              ManagedGameplay.IDENTITY,
                              () ->
                                  nickname(player, command.getArgument("arguments", String.class)));
                          return 1;
                        }))
            .build(),
        "Set your plain-text nickname: /nick <name|off>");
    registerToggle(commands, "msgtoggle", Identity::toggleMessages, ManagedGameplay.IDENTITY);
    registerToggle(commands, "rtoggle", Identity::toggleReplies, ManagedGameplay.IDENTITY);
    registerToggle(commands, "socialspy", Identity::toggleSpy, ManagedGameplay.STAFF);
    commands.register(
        literal("realname")
            .requires(
                source ->
                    identities.ready()
                        && source.getSender() instanceof Player
                        && source.getSender().hasPermission("thestorm.essentials.realname"))
            .then(
                argument("nickname", greedyString())
                    .executes(
                        command -> {
                          var sender = (Player) command.getSource().getSender();
                          var name = command.getArgument("nickname", String.class);
                          gated(sender, ManagedGameplay.IDENTITY, () -> realName(sender, name));
                          return 1;
                        }))
            .build(),
        "Find the real username behind a nickname");
  }

  private void realName(Player sender, String name) {
    var id = identities.named(name);
    if (id.isEmpty()) {
      sender.sendMessage(Component.text("No visible player has that nickname."));
      return;
    }
    var online = context.plugin().getServer().getPlayer(id.orElseThrow());
    if ((online != null && !PlayerVisibility.visibleTo(sender, online))
        || (PlayerVisibility.hidden(id.orElseThrow())
            && !sender.hasPermission(PlayerVisibility.SEE))) {
      sender.sendMessage(Component.text("No visible player has that nickname."));
      return;
    }
    var _ =
        context
            .services()
            .require(PlayerDirectory.class)
            .byId(id.orElseThrow())
            .thenAcceptAsync(
                known ->
                    sender.sendMessage(
                        Component.text(
                            known
                                .map(player -> name + " is " + player.lastName())
                                .orElse("Unknown player."))),
                context.scheduler().mainThread());
  }

  private void registerToggle(
      Commands commands, String name, UnaryOperator<Identity> toggle, String gate) {
    var permission = "thestorm.essentials." + name;
    commands.register(
        literal(name)
            .requires(
                source ->
                    identities.ready()
                        && source.getSender() instanceof Player
                        && source.getSender().hasPermission(permission))
            .executes(
                command -> {
                  var player = (Player) command.getSource().getSender();
                  gated(player, gate, () -> update(player, player.getUniqueId(), toggle, name));
                  return 1;
                })
            .build(),
        "Toggle " + name);
  }

  private void nickname(Player actor, String arguments) {
    var parts = arguments.split("\\s+", 2);
    Player target = actor;
    String requested = parts[0];
    if (parts.length == 2) {
      if (!actor.hasPermission("thestorm.essentials.nick.others")) {
        actor.sendMessage(Component.text("You cannot change another player's nickname."));
        return;
      }
      var found = context.plugin().getServer().getPlayerExact(parts[0]);
      if (found == null || !PlayerVisibility.visibleTo(actor, found)) {
        actor.sendMessage(Component.text("That player is not online."));
        return;
      }
      target = found;
      requested = parts[1];
    }
    var name =
        "off".equalsIgnoreCase(requested) ? Optional.<String>empty() : Optional.of(requested);
    var id = target.getUniqueId();
    if (name.isEmpty()) {
      update(actor, id, identity -> identity.named(name), "nick");
      return;
    }
    var collision = identities.named(name.orElseThrow()).filter(other -> !other.equals(id));
    if (collision.isPresent()) {
      actor.sendMessage(Component.text("That nickname is already used."));
      return;
    }
    var _ =
        context
            .services()
            .require(PlayerDirectory.class)
            .byName(name.orElseThrow())
            .whenCompleteAsync(
                (known, error) -> {
                  if (error != null) {
                    failure(actor, error);
                    return;
                  }
                  if (known.isPresent() && !known.orElseThrow().uuid().equals(id)) {
                    actor.sendMessage(Component.text("That is another player's username."));
                    return;
                  }
                  update(actor, id, identity -> identity.named(name), "nick");
                },
                context.scheduler().mainThread());
  }

  private void update(Player actor, UUID target, UnaryOperator<Identity> update, String command) {
    if (!actor.isOnline()
        || !actor.hasPermission("thestorm.essentials." + command)
        || (!actor.getUniqueId().equals(target)
            && !actor.hasPermission("thestorm.essentials.nick.others"))) {
      actor.sendMessage(Component.text("You do not have permission for that identity change."));
      return;
    }
    var _ =
        identities
            .change(
                target,
                update,
                new com.shepherdjerred.thestorm.chat.app.IdentityStore.Audit(
                    actor.getUniqueId(), context.time().instant(), command))
            .whenCompleteAsync(
                (saved, error) -> {
                  if (error != null) {
                    failure(actor, error);
                    return;
                  }
                  var online = context.plugin().getServer().getPlayer(target);
                  if (online != null) apply(online);
                  actor.sendMessage(
                      Component.text(
                          "Saved. Messages: "
                              + saved.messages()
                              + "; replies: "
                              + saved.replies()
                              + "; SocialSpy: "
                              + saved.socialSpy()));
                },
                context.scheduler().mainThread());
  }

  private void gated(Player player, String key, Runnable action) {
    var _ =
        context
            .services()
            .require(ManagedGameplay.class)
            .enabled(key, player.getUniqueId())
            .whenCompleteAsync(
                (enabled, failure) -> {
                  if (failure != null) {
                    failure(player, failure);
                    return;
                  }
                  if (Boolean.TRUE.equals(enabled) && player.isOnline()) action.run();
                  else player.sendMessage(Component.text("This feature is not enabled for you."));
                },
                context.scheduler().mainThread());
  }

  private void failure(Player actor, Throwable error) {
    var cause =
        error instanceof java.util.concurrent.CompletionException && error.getCause() != null
            ? java.util.Objects.requireNonNull(error.getCause())
            : error;
    if (cause instanceof IllegalArgumentException invalid) {
      actor.sendMessage(Component.text(java.util.Objects.requireNonNull(invalid.getMessage())));
      return;
    }
    context.logger().error("Identity update failed for {}", actor.getUniqueId(), error);
    actor.sendMessage(
        Component.text("Could not save that identity change. Use a valid, unused nickname."));
  }

  public void apply(Player player) {
    var _ =
        context
            .services()
            .require(ManagedGameplay.class)
            .enabled(ManagedGameplay.IDENTITY, player.getUniqueId())
            .whenCompleteAsync(
                (enabled, failure) -> {
                  identities.displaying(
                      player.getUniqueId(), failure == null && Boolean.TRUE.equals(enabled));
                  if (!player.isOnline()) return;
                  var display =
                      Component.text(
                          identities
                              .effective(player.getUniqueId())
                              .nickname()
                              .orElseGet(player::getName));
                  player.displayName(display);
                  player.playerListName(display);
                },
                context.scheduler().mainThread());
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    if (!identities.ready()) return;
    var player = event.getPlayer();
    apply(player);
    var collision =
        identities.named(player.getName()).filter(id -> !id.equals(player.getUniqueId()));
    collision.ifPresent(
        id -> {
          var _ =
              identities
                  .change(
                      id,
                      identity -> identity.named(Optional.empty()),
                      new com.shepherdjerred.thestorm.chat.app.IdentityStore.Audit(
                          new UUID(0, 0), context.time().instant(), "username-collision"))
                  .whenCompleteAsync(
                      (saved, failure) -> {
                        if (failure != null) {
                          context.logger().error("Could not remove a colliding nickname", failure);
                          return;
                        }
                        var online = context.plugin().getServer().getPlayer(id);
                        if (online != null) apply(online);
                      },
                      context.scheduler().mainThread());
        });
  }
}
