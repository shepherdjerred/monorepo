package com.shepherdjerred.thestorm.essentials.adapter.paper;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.block.CreatureSpawner;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.ItemStack;

/** Bounded item/entity administration and permission-preserving player command tools. */
final class StaffEntities implements Listener {
  private final StaffCommands tools;
  private final Map<UUID, Map<Material, String>> commands = new HashMap<>();
  private final java.util.Set<UUID> disabled = new java.util.HashSet<>();
  private final java.util.Set<UUID> unlimited = new java.util.HashSet<>();
  private final java.util.Set<UUID> pending = new java.util.HashSet<>();

  StaffEntities(StaffCommands tools) {
    this.tools = tools;
  }

  void register() {
    tools.permission("sudo.exempt");
    tools.add(
        "give <material> [amount] [player]",
        request -> {
          var item = material(request.word(0));
          var amount = request.words().length > 1 ? request.number(1, 1, 64) : 1;
          var target = request.target(2);
          request.others(target);
          var remaining = target.getInventory().addItem(new ItemStack(item, amount));
          remaining
              .values()
              .forEach(
                  stack -> target.getWorld().dropItemNaturally(Positions.current(target), stack));
          request.say("Items delivered.");
        });
    tools.add("spawnmob <type> [count]", this::spawn);
    tools.add(
        "spawner <type>",
        request -> {
          var block = request.self().getTargetBlockExact(6);
          if (block == null || !(block.getState() instanceof CreatureSpawner spawner))
            throw new IllegalArgumentException("Look at a spawner within six blocks.");
          tools.build(request, block.getLocation());
          spawner.setSpawnedType(type(request.word(0)));
          spawner.update();
          request.say("Spawner changed.");
        });
    tools.add("remove <type|all> [radius]", request -> remove(request, false));
    tools.add("kill <type|all> [radius]", request -> remove(request, true));
    tools.add(
        "sudo <player> <command>",
        request -> {
          var target = tools.player(request.actor(), request.word(0));
          request.others(target);
          if (target.isOp() || target.hasPermission("thestorm.essentials.sudo.exempt"))
            throw new IllegalArgumentException("That player is exempt from sudo.");
          request.word(1);
          var command = request.input().trim().split("\\s+", 2)[1];
          if (command.startsWith("/")) command = command.substring(1);
          target.performCommand(command);
          request.say("Command executed with the target player's permissions.");
        });
    playerTools();
  }

  @EventHandler
  void quit(org.bukkit.event.player.PlayerQuitEvent event) {
    var id = event.getPlayer().getUniqueId();
    pending.remove(id);
    disabled.remove(id);
    unlimited.remove(id);
    commands.remove(id);
  }

  private void playerTools() {
    tools.add(
        "unlimited",
        request -> {
          var id = request.self().getUniqueId();
          if (!unlimited.remove(id)) unlimited.add(id);
          request.say("Unlimited held item: " + unlimited.contains(id));
        });
    tools.add(
        "powertool <command|off>",
        request -> {
          var item = request.self().getInventory().getItemInMainHand().getType();
          if (item.isAir()) throw new IllegalArgumentException("Hold an item first.");
          var playerCommands =
              commands.computeIfAbsent(request.self().getUniqueId(), _ -> new HashMap<>());
          if ("off".equals(request.input())) playerCommands.remove(item);
          else {
            request.word(0);
            playerCommands.put(item, request.input());
          }
          request.say("Powertool updated for " + item + ".");
        });
    tools.add(
        "powertoollist",
        request ->
            request.say(commands.getOrDefault(request.self().getUniqueId(), Map.of()).toString()));
    tools.add(
        "powertooltoggle",
        request -> {
          var id = request.self().getUniqueId();
          if (!disabled.remove(id)) disabled.add(id);
          request.say("Powertools enabled: " + !disabled.contains(id));
        });
  }

  private void spawn(StaffCommands.Request request) {
    var type = type(request.word(0));
    int count = request.words().length > 1 ? request.number(1, 1, tools.settings.entityLimit()) : 1;
    var location =
        Positions.current(request.self())
            .add(Positions.current(request.self()).getDirection().multiply(2));
    tools.build(request, location);
    for (int index = 0; index < count; index++) location.getWorld().spawnEntity(location, type);
    request.say("Spawned " + count + " " + type + ".");
  }

  private void remove(StaffCommands.Request request, boolean kill) {
    var self = request.self();
    var wanted = request.word(0);
    var type = "all".equals(wanted) ? null : type(wanted);
    int radius =
        request.words().length > 1
            ? request.number(1, 1, tools.settings.effectRadius())
            : tools.settings.effectRadius();
    var entities =
        self.getNearbyEntities(radius, radius, radius).stream()
            .filter(
                entity ->
                    !(entity instanceof Player)
                        && !entity.hasMetadata("NPC")
                        && (type == null || entity.getType() == type))
            .limit(tools.settings.entityLimit())
            .toList();
    for (var entity : entities) {
      tools.build(request, entity.getLocation());
      if (kill && entity instanceof LivingEntity living) living.setHealth(0);
      else entity.remove();
    }
    request.say("Affected " + entities.size() + " entities.");
  }

  @EventHandler(ignoreCancelled = true)
  void interact(PlayerInteractEvent event) {
    if (!event.getAction().isRightClick()
        || event.getHand() != org.bukkit.inventory.EquipmentSlot.HAND) return;
    var player = event.getPlayer();
    var id = player.getUniqueId();
    var held = player.getInventory().getItemInMainHand().clone();
    var slot = player.getInventory().getHeldItemSlot();
    boolean refill =
        unlimited.contains(id) && tools.available(player, "unlimited") && !held.getType().isAir();
    var command =
        commands
            .getOrDefault(id, Map.of())
            .get(player.getInventory().getItemInMainHand().getType());
    var power = command != null && !disabled.contains(id) && tools.available(player, "powertool");
    if ((!refill && !power) || !pending.add(id)) return;
    if (power) event.setCancelled(true);
    authorize(player, new Use(slot, held, refill, power ? command : null));
  }

  private void authorize(Player player, Use use) {
    var id = player.getUniqueId();
    var permission = use.command() == null ? "unlimited" : "powertool";
    try {
      var authorization =
          tools
              .context
              .services()
              .require(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class)
              .enabled(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.STAFF, id)
              .handle((enabled, error) -> error == null && Boolean.TRUE.equals(enabled));
      var _ =
          authorization.whenComplete(
              (enabled, error) -> {
                if (error != null || !player.isOnline()) pending.remove(id);
              });
      tools.complete(
          player,
          authorization,
          enabled -> {
            try {
              if (!enabled || !tools.available(player, permission)) {
                pending.remove(id);
                return;
              }
              use(player, use);
            } catch (RuntimeException failure) {
              pending.remove(id);
              throw failure;
            }
          });
    } catch (RuntimeException failure) {
      pending.remove(id);
      throw failure;
    }
  }

  private record Use(
      int slot,
      ItemStack held,
      boolean refill,
      @org.jspecify.annotations.Nullable String command) {}

  private void use(Player player, Use use) {
    var id = player.getUniqueId();
    var audit =
        new com.shepherdjerred.thestorm.essentials.app.StaffStore.Audit(
            id.toString(),
            use.command() == null ? "unlimited.use" : "powertool.use",
            use.held().getType().name(),
            tools.context.time().instant());
    var _ =
        tools
            .state
            .commit(List.of(), audit)
            .whenCompleteAsync(
                (done, error) -> {
                  pending.remove(id);
                  if (error != null) {
                    tools.context.logger().error("Powertool audit failed", error);
                    return;
                  }
                  applyUse(player, use);
                },
                tools.context.scheduler().mainThread());
  }

  private void applyUse(Player player, Use use) {
    if (!player.isOnline() || player.getInventory().getHeldItemSlot() != use.slot()) return;
    if (use.refill() && tools.available(player, "unlimited")) {
      var current = player.getInventory().getItemInMainHand();
      if (current.getType().isAir() || current.isSimilar(use.held())) {
        var item = use.held().clone();
        item.setAmount(item.getMaxStackSize());
        player.getInventory().setItemInMainHand(item);
      }
    }
    if (use.command() != null && tools.available(player, "powertool"))
      player.performCommand(use.command());
  }

  private static Material material(String name) {
    var material = Material.matchMaterial(name);
    if (material == null || !material.isItem())
      throw new IllegalArgumentException("Unknown item material.");
    return material;
  }

  private static EntityType type(String name) {
    var type = EntityType.valueOf(name.toUpperCase(Locale.ROOT));
    if (!type.isSpawnable() || type == EntityType.PLAYER)
      throw new IllegalArgumentException("That entity type cannot be spawned.");
    return type;
  }
}
