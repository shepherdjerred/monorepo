package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.shepherdjerred.thestorm.core.expansion.ExpansionSettings;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.app.StaffStore;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;

/** Staff command authorization, flags, durable audit and destructive-action confirmation. */
final class StaffCommands {
  private static final Set<String> CONFIRMED =
      Set.of(
          "tpall",
          "tpaall",
          "kickall",
          "remove",
          "kill",
          "nuke",
          "antioch",
          "break",
          "bigtree",
          "tree",
          "burn",
          "ice",
          "lightning",
          "fireball",
          "firework",
          "beezooka",
          "kittycannon");

  record Pending(String input, List<String> targets, Instant expires) {}

  record Definition(String usage, Consumer<Request> handler) {}

  record Request(
      StaffCommands tools,
      CommandSender actor,
      String command,
      String input,
      List<String> arguments) {
    Request(StaffCommands tools, CommandSender actor, String command, String input) {
      this(
          tools,
          actor,
          command,
          input,
          input.isBlank() ? List.of() : List.of(input.trim().split("\\s+")));
    }

    String[] words() {
      return arguments.toArray(String[]::new);
    }

    String word(int index) {
      var args = words();
      if (index >= args.length)
        throw new IllegalArgumentException(
            "Usage: /" + java.util.Objects.requireNonNull(tools.definitions.get(command)).usage());
      return args[index];
    }

    Player self() {
      if (actor instanceof Player player) return player;
      throw new IllegalArgumentException("Use this command in-game.");
    }

    Player target(int index) {
      return index >= words().length ? self() : tools.player(actor, word(index));
    }

    void others(Player target) {
      if (!target.equals(actor)) require("thestorm.essentials." + command + ".others");
    }

    void require(String permission) {
      if (!actor.hasPermission(permission))
        throw new IllegalArgumentException("You do not have permission for that action.");
    }

    void say(String text) {
      actor.sendMessage(Component.text(text));
    }

    void save(List<StaffStore.Entry> entries, Runnable action) {
      tools.complete(
          actor,
          tools.state.commit(entries, tools.audit(this)),
          _ -> {
            require("thestorm.essentials." + command);
            action.run();
          });
    }

    int number(int index, int min, int max) {
      var value = Integer.parseInt(word(index));
      if (value < min || value > max)
        throw new IllegalArgumentException("Use a number from " + min + " to " + max + ".");
      return value;
    }
  }

  final ModuleContext context;
  final StaffState state;
  final ExpansionSettings settings;
  private final GuardRegistry guards;
  private final Protection protection;
  private final SealedWorlds sealed;
  private final Map<String, Definition> definitions = new HashMap<>();
  private final Map<CommandSender, Pending> pending = new HashMap<>();
  private final List<Permission> permissions = new ArrayList<>();

  StaffCommands(ModuleContext context, StaffState state, EssentialsPaper.App app) {
    this.context = context;
    this.state = state;
    settings = context.services().require(ExpansionSettings.class);
    guards = app.guards();
    protection = app.protection();
    sealed = app.sealed();
  }

  void add(String usage, Consumer<Request> handler) {
    var name = usage.split(" ", 2)[0];
    if (definitions.putIfAbsent(name, new Definition(usage, handler)) != null)
      throw new IllegalStateException("Duplicate command: " + name);
    permission(name);
    permission(name + ".others");
  }

  void permission(String suffix) {
    var name = "thestorm.essentials." + suffix;
    var manager = context.plugin().getServer().getPluginManager();
    if (manager.getPermission(name) != null) return;
    var permission = new Permission(name, "Staff: " + suffix, PermissionDefault.OP);
    manager.addPermission(permission);
    permissions.add(permission);
  }

  void register(Commands commands) {
    definitions.forEach(
        (name, definition) ->
            commands.register(
                literal(name)
                    .requires(
                        source ->
                            state.ready()
                                && source.getSender().hasPermission("thestorm.essentials." + name))
                    .executes(command -> invoke(command.getSource().getSender(), name, ""))
                    .then(
                        argument("arguments", greedyString())
                            .executes(
                                command ->
                                    invoke(
                                        command.getSource().getSender(),
                                        name,
                                        command.getArgument("arguments", String.class))))
                    .build(),
                definition.usage()));
  }

  void stop() {
    permissions.forEach(context.plugin().getServer().getPluginManager()::removePermission);
    pending.clear();
  }

  Map<String, String> guide(CommandSender sender) {
    var visible = new java.util.TreeMap<String, String>();
    definitions.forEach(
        (name, definition) -> {
          if (sender.hasPermission("thestorm.essentials." + name))
            visible.put(name, definition.usage());
        });
    return visible;
  }

  private int invoke(CommandSender actor, String name, String input) {
    if (!(actor instanceof Player)
        && context.plugin().getServer().getCommandMap().getCommand("minecraft:" + name) != null) {
      return context
              .plugin()
              .getServer()
              .dispatchCommand(actor, "minecraft:" + name + (input.isBlank() ? "" : " " + input))
          ? 1
          : 0;
    }
    return staffInvoke(actor, name, input);
  }

  private int staffInvoke(CommandSender actor, String name, String input) {
    var id = actor instanceof Player player ? player.getUniqueId() : new UUID(0, 0);
    complete(
        actor,
        context.services().require(ManagedGameplay.class).enabled(ManagedGameplay.STAFF, id),
        enabled -> {
          if (!enabled) {
            actor.sendMessage(Component.text("Staff tools are not enabled for you."));
            return;
          }
          var request = new Request(this, actor, name, input);
          request.require("thestorm.essentials." + name);
          if (actor instanceof Player player && sealed.isSealed(player.getWorld()))
            throw new IllegalArgumentException("Staff tools are unavailable in this world.");
          if (!confirm(request)) return;
          var targets = snapshot(request);
          complete(
              actor,
              state.commit(List.of(), audit(request)),
              _ -> {
                request.require("thestorm.essentials." + name);
                if (CONFIRMED.contains(name) && !targets.equals(snapshot(request)))
                  throw new IllegalArgumentException(
                      "Targets changed. Repeat the command to confirm again.");
                java.util.Objects.requireNonNull(definitions.get(name)).handler().accept(request);
              });
        });
    return 1;
  }

  private boolean confirm(Request request) {
    if (!CONFIRMED.contains(request.command())) return true;
    var input = request.command() + " " + request.input();
    var targets = snapshot(request);
    var previous = pending.remove(request.actor());
    var now = context.time().instant();
    pending.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expires()));
    if (previous != null
        && previous.input().equals(input)
        && previous.targets().equals(targets)
        && now.isBefore(previous.expires())) return true;
    pending.put(
        request.actor(),
        new Pending(input, targets, now.plusSeconds(settings.confirmationSeconds())));
    request.say(
        "Repeat /"
            + input
            + " within "
            + settings.confirmationSeconds()
            + " seconds to confirm. Targets will be checked again.");
    return false;
  }

  private StaffStore.Audit audit(Request request) {
    return new StaffStore.Audit(
        request.actor() instanceof Player player ? player.getUniqueId().toString() : "console",
        request.command(),
        CONFIRMED.contains(request.command())
            ? String.join(",", snapshot(request))
            : request.input().isBlank() ? "self" : request.input(),
        context.time().instant());
  }

  boolean available(Player player, String permission) {
    return player.isOnline()
        && player.hasPermission("thestorm.essentials." + permission)
        && !sealed.isSealed(player.getWorld());
  }

  private List<String> snapshot(Request request) {
    var targets = new ArrayList<String>();
    context
        .plugin()
        .getServer()
        .getOnlinePlayers()
        .forEach(player -> targets.add(player.getUniqueId().toString()));
    if (request.actor() instanceof Player player) {
      targets.add("origin:" + Positions.of(player).describe());
      var block =
          player.getTargetBlockExact(settings.effectRadius(), org.bukkit.FluidCollisionMode.ALWAYS);
      if (block != null) targets.add("block:" + Positions.of(block.getLocation()).describe());
      if (Set.of("remove", "kill").contains(request.command()))
        player
            .getNearbyEntities(
                settings.effectRadius(), settings.effectRadius(), settings.effectRadius())
            .forEach(entity -> targets.add(entity.getUniqueId().toString()));
    }
    return targets.stream().sorted().toList();
  }

  Player player(CommandSender actor, String name) {
    var target = context.plugin().getServer().getPlayerExact(name);
    if (target == null || !PlayerVisibility.visibleTo(actor, target))
      throw new IllegalArgumentException("That player is not online.");
    if (sealed.isSealed(target.getWorld()))
      throw new IllegalArgumentException("That player's world is sealed.");
    return target;
  }

  void build(Request request, Location location) {
    if (sealed.isSealed(location) || !location.getWorld().getWorldBorder().isInside(location))
      throw new IllegalArgumentException("This location is unavailable.");
    if (protection.check(request.self().getUniqueId(), ProtectedAction.BUILD, location)
        instanceof Decision.Denied(var reason))
      throw new IllegalArgumentException(
          "Land protection refuses this change: "
              + net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                  .serialize(reason));
  }

  void teleport(Request request, Player mover, Location location, boolean override) {
    if (location.getY() < location.getWorld().getMinHeight()
        || location.getY() >= location.getWorld().getMaxHeight())
      throw new IllegalArgumentException("Destination is outside the world's height range.");
    complete(
        request.actor(),
        location.getWorld().getChunkAtAsync(location),
        _ -> safeTeleport(request, mover, location, override));
  }

  private void safeTeleport(Request request, Player mover, Location destination, boolean override) {
    var location =
        SafeLocations.nearestSafe(destination)
            .orElseThrow(() -> new IllegalArgumentException("No safe landing found."));
    request.require("thestorm.essentials." + request.command());
    if (sealed.isSealed(mover.getWorld()) || sealed.isSealed(location))
      throw new IllegalArgumentException("That world is sealed.");
    if (!mover.isOnline()) throw new IllegalArgumentException("That player left.");
    if (override) request.require("thestorm.essentials.teleport.override");
    else {
      var refusal = guards.check(mover.getUniqueId(), location);
      if (refusal.isPresent()) {
        request.actor().sendMessage(refusal.orElseThrow());
        return;
      }
      if (protection.check(mover.getUniqueId(), ProtectedAction.TELEPORT_INTO, location)
          instanceof Decision.Denied(var reason)) {
        request.actor().sendMessage(reason);
        return;
      }
    }
    if (!location.getWorld().getWorldBorder().isInside(location))
      throw new IllegalArgumentException("Destination is outside the world border.");
    complete(
        request.actor(),
        mover.teleportAsync(location),
        moved ->
            request.say(moved ? "Teleported " + mover.getName() + "." : "Teleport was refused."));
  }

  <T> void complete(CommandSender actor, CompletableFuture<T> future, Consumer<T> action) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (actor instanceof Player player && !player.isOnline()) return;
              if (failure != null) {
                context.logger().error("Staff operation failed", failure);
                actor.sendMessage(Component.text("Could not complete that request."));
                return;
              }
              try {
                action.accept(value);
              } catch (IllegalArgumentException invalid) {
                actor.sendMessage(
                    Component.text(java.util.Objects.requireNonNull(invalid.getMessage())));
              } catch (RuntimeException runtimeFailure) {
                context.logger().error("Staff command failed", runtimeFailure);
                actor.sendMessage(Component.text("Could not complete that staff command."));
              }
            },
            context.scheduler().mainThread());
  }
}
