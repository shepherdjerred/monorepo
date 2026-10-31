package com.shepherdjerred.mcbridge.adapter.paper;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import com.shepherdjerred.mcbridge.domain.PlainText;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/** Server facts, players and console commands. */
public final class ServerService {
  private final Server server;
  private final MainThread mainThread;
  private final EventRing events;

  public ServerService(Server server, MainThread mainThread, EventRing events) {
    this.server = server;
    this.mainThread = mainThread;
    this.events = events;
  }

  /** Looks up a world or fails with {@code not_found}. Main thread only. */
  public World world(String name) {
    World world = server.getWorld(name);
    if (world == null) {
      throw new BridgeException(ErrorCode.NOT_FOUND, "no world named " + name);
    }
    return world;
  }

  /** The {@code worlds} and {@code plugins} parts of {@code /v1/info}. */
  public JsonObject serverFacts() {
    return mainThread.call(this::collectFacts, MainThread.DEFAULT_TIMEOUT);
  }

  private JsonObject collectFacts() {
    JsonObject facts = new JsonObject();
    facts.addProperty("minecraftVersion", server.getMinecraftVersion());
    facts.addProperty("serverVersion", server.getVersion());
    facts.addProperty("onlineMode", server.getOnlineMode());
    JsonArray worlds = new JsonArray();
    for (World world : server.getWorlds()) {
      JsonObject entry = new JsonObject();
      entry.addProperty("name", world.getName());
      entry.addProperty("key", world.getKey().asString());
      entry.addProperty("environment", world.getEnvironment().name());
      entry.addProperty("minY", world.getMinHeight());
      entry.addProperty("maxY", world.getMaxHeight() - 1);
      worlds.add(entry);
    }
    facts.add("worlds", worlds);
    JsonArray plugins = new JsonArray();
    for (Plugin plugin : server.getPluginManager().getPlugins()) {
      JsonObject entry = new JsonObject();
      entry.addProperty("name", plugin.getName());
      entry.addProperty("version", plugin.getPluginMeta().getVersion());
      entry.addProperty("enabled", plugin.isEnabled());
      plugins.add(entry);
    }
    facts.add("plugins", plugins);
    return facts;
  }

  /** {@code /v1/evidence}: private results never pass through console capture. */
  public String evidence(String query) {
    if (server.getPluginManager().getPlugin("TheStorm") == null)
      throw new BridgeException(ErrorCode.UNSUPPORTED, "The Storm evidence service is unavailable");
    try {
      return mainThread.callAsync(
          () -> {
            var access =
                server
                    .getServicesManager()
                    .load(com.shepherdjerred.thestorm.core.safety.EvidenceAccess.class);
            if (access == null)
              throw new BridgeException(
                  ErrorCode.UNSUPPORTED, "The Storm evidence service is unavailable");
            return access.query(query, "mcbridge");
          },
          MainThread.DEFAULT_TIMEOUT);
    } catch (IllegalArgumentException invalid) {
      throw BridgeException.badRequest("Invalid evidence query");
    }
  }

  /** {@code /v1/players}. */
  public JsonObject players() {
    return mainThread.call(this::collectPlayers, MainThread.DEFAULT_TIMEOUT);
  }

  /** Bounded module state for fixture admission and cleanup verification. */
  public JsonObject captureInspection(com.shepherdjerred.mcbridge.domain.Box box) {
    requireStorm();
    box.requireVolumeAtMost(32768);
    return mainThread.call(
        () -> {
          var access =
              server
                  .getServicesManager()
                  .load(com.shepherdjerred.thestorm.core.capture.CaptureInspection.class);
          if (access == null)
            throw new BridgeException(ErrorCode.UNSUPPORTED, "Capture inspection is unavailable");
          var world = world(box.world());
          box.requireWithinHeight(world.getMinHeight(), world.getMaxHeight() - 1);
          var area =
              new com.shepherdjerred.thestorm.core.capture.CaptureArea(
                  world.getName(),
                  world.getUID(),
                  box.min().x(),
                  box.min().y(),
                  box.min().z(),
                  box.max().x(),
                  box.max().y(),
                  box.max().z());
          var response = new JsonObject();
          var inspection = new JsonObject();
          access.inspect(area).forEach(inspection::addProperty);
          response.add("inspection", inspection);
          return response;
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  public JsonObject capturePlayer(String name) {
    requireStorm();
    return mainThread.call(
        () -> {
          var player = server.getPlayerExact(name);
          if (player == null)
            throw new BridgeException(ErrorCode.NOT_FOUND, "Capture player is not online");
          var result = new JsonObject();
          result.addProperty("name", player.getName());
          result.addProperty("uuid", player.getUniqueId().toString());
          result.addProperty(
              "inventory", java.util.Base64.getEncoder().encodeToString(inventoryBytes(player)));
          result.addProperty("gameMode", player.getGameMode().name());
          result.addProperty("health", player.getHealth());
          result.addProperty("food", player.getFoodLevel());
          result.addProperty("saturation", player.getSaturation());
          result.addProperty("exhaustion", player.getExhaustion());
          result.addProperty("allowFlight", player.getAllowFlight());
          result.addProperty("flying", player.isFlying());
          result.addProperty("flySpeed", player.getFlySpeed());
          result.addProperty("invulnerable", player.isMarkedInvulnerable());
          result.addProperty("fireTicks", player.getFireTicks());
          result.addProperty("level", player.getLevel());
          result.addProperty("exp", player.getExp());
          result.addProperty("totalExp", player.getTotalExperience());
          result.addProperty("slot", player.getInventory().getHeldItemSlot());
          var effects = new JsonArray();
          for (var effect : player.getActivePotionEffects()) {
            var row = new JsonObject();
            row.addProperty("type", effect.getType().getKey().toString());
            row.addProperty("duration", effect.getDuration());
            row.addProperty("amplifier", effect.getAmplifier());
            row.addProperty("ambient", effect.isAmbient());
            row.addProperty("particles", effect.hasParticles());
            row.addProperty("icon", effect.hasIcon());
            effects.add(row);
          }
          result.add("effects", effects);
          var access =
              server
                  .getServicesManager()
                  .load(com.shepherdjerred.thestorm.core.capture.CaptureInspection.class);
          if (access == null)
            throw new BridgeException(ErrorCode.UNSUPPORTED, "Capture inspection is unavailable");
          var modules = new JsonObject();
          access.player(player.getUniqueId()).forEach(modules::addProperty);
          result.add("moduleState", modules);
          return result;
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  public JsonObject captureCleanup(String name, String resource, String id) {
    requireStorm();
    return mainThread.callAsync(
        () -> {
          var player = server.getPlayerExact(name);
          var access =
              server
                  .getServicesManager()
                  .load(com.shepherdjerred.thestorm.core.capture.CaptureInspection.class);
          if (player == null || access == null)
            throw new BridgeException(ErrorCode.UNSUPPORTED, "Capture recovery is unavailable");
          return access
              .cleanup(player.getUniqueId(), resource, id)
              .thenApply(
                  _ -> {
                    var result = new JsonObject();
                    result.addProperty("removed", true);
                    return result;
                  });
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  public JsonObject restoreCapturePlayer(com.shepherdjerred.mcbridge.adapter.http.Fields request) {
    requireStorm();
    var checkpoint =
        request.object(
            "checkpoint",
            java.util.Set.of(
                "uuid",
                "name",
                "inventory",
                "gameMode",
                "health",
                "food",
                "saturation",
                "exhaustion",
                "allowFlight",
                "flying",
                "flySpeed",
                "invulnerable",
                "fireTicks",
                "level",
                "exp",
                "totalExp",
                "slot",
                "effects",
                "moduleState"));
    var items =
        org.bukkit.inventory.ItemStack.deserializeItemsFromBytes(
            java.util.Base64.getDecoder().decode(checkpoint.string("inventory")));
    var expected = request.string("expectedInventory");
    return mainThread.call(
        () -> {
          var player = server.getPlayerExact(checkpoint.string("name"));
          if (player == null || !player.getUniqueId().toString().equals(checkpoint.string("uuid")))
            throw new BridgeException(ErrorCode.NOT_FOUND, "Capture player identity changed");
          var current = java.util.Base64.getEncoder().encodeToString(inventoryBytes(player));
          if (!current.equals(expected))
            throw BridgeException.badRequest("Inventory changed since recovery inspection");
          var effects = captureEffects(checkpoint);
          var values = captureVitals(checkpoint, player, items.length);
          var flight = captureFlight(checkpoint);
          player.getInventory().setContents(items);
          for (var effect : player.getActivePotionEffects())
            player.removePotionEffect(effect.getType());
          effects.forEach(player::addPotionEffect);
          player.setGameMode(values.mode());
          player.setHealth(values.health());
          player.setFoodLevel(values.food());
          player.setSaturation(values.saturation());
          player.setExhaustion(flight.exhaustion());
          player.setAllowFlight(flight.allowed());
          player.setFlying(flight.flying());
          player.setFlySpeed(flight.speed());
          player.setInvulnerable(flight.invulnerable());
          player.setFireTicks(flight.fireTicks());
          player.setLevel(values.level());
          player.setExp(values.exp());
          player.setTotalExperience(values.totalExp());
          player.getInventory().setHeldItemSlot(values.slot());
          var result = new JsonObject();
          result.addProperty("restored", true);
          return result;
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  private record CaptureFlight(
      float exhaustion,
      boolean allowed,
      boolean flying,
      float speed,
      boolean invulnerable,
      int fireTicks) {}

  private static CaptureFlight captureFlight(
      com.shepherdjerred.mcbridge.adapter.http.Fields checkpoint) {
    var exhaustion = checkpoint.number("exhaustion");
    var speed = checkpoint.number("flySpeed");
    var allowed = checkpoint.bool("allowFlight");
    var flying = checkpoint.bool("flying");
    if (exhaustion < 0 || speed < -1 || speed > 1 || (flying && !allowed))
      throw BridgeException.badRequest("Invalid flight checkpoint");
    return new CaptureFlight(
        (float) exhaustion,
        allowed,
        flying,
        (float) speed,
        checkpoint.bool("invulnerable"),
        checkpoint.integer("fireTicks"));
  }

  private record CaptureVitals(
      org.bukkit.GameMode mode,
      double health,
      int food,
      float saturation,
      int level,
      float exp,
      int totalExp,
      int slot) {}

  private static CaptureVitals captureVitals(
      com.shepherdjerred.mcbridge.adapter.http.Fields checkpoint, Player player, int slots) {
    var mode = org.bukkit.GameMode.valueOf(checkpoint.string("gameMode"));
    var health = checkpoint.number("health");
    var food = checkpoint.integer("food");
    var saturation = checkpoint.number("saturation");
    var level = checkpoint.integer("level");
    var exp = checkpoint.number("exp");
    var total = checkpoint.integer("totalExp");
    var slot = checkpoint.integer("slot");
    var maxHealth =
        java.util.Objects.requireNonNull(
                player.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH))
            .getValue();
    if (slots != player.getInventory().getSize()
        || !Double.isFinite(health)
        || health <= 0
        || health > maxHealth
        || food < 0
        || food > 20
        || !Double.isFinite(saturation)
        || saturation < 0
        || saturation > 20
        || level < 0
        || !Double.isFinite(exp)
        || exp < 0
        || exp > 1
        || total < 0
        || slot < 0
        || slot > 8) throw BridgeException.badRequest("Invalid player checkpoint");
    return new CaptureVitals(
        mode, health, food, (float) saturation, level, (float) exp, total, slot);
  }

  private static List<org.bukkit.potion.PotionEffect> captureEffects(
      com.shepherdjerred.mcbridge.adapter.http.Fields checkpoint) {
    var effects = new ArrayList<org.bukkit.potion.PotionEffect>();
    for (var row : checkpoint.array("effects")) {
      var effect =
          com.shepherdjerred.mcbridge.adapter.http.Fields.of(
              row,
              "effect",
              java.util.Set.of("type", "duration", "amplifier", "ambient", "particles", "icon"));
      var key = org.bukkit.NamespacedKey.fromString(effect.string("type"));
      var type = key == null ? null : org.bukkit.Registry.MOB_EFFECT.get(key);
      if (type == null) throw BridgeException.badRequest("Unknown potion effect");
      effects.add(
          new org.bukkit.potion.PotionEffect(
              type,
              effect.integer("duration"),
              effect.integer("amplifier"),
              effect.bool("ambient"),
              effect.bool("particles"),
              effect.bool("icon")));
    }
    return effects;
  }

  private void requireStorm() {
    if (server.getPluginManager().getPlugin("TheStorm") == null)
      throw new BridgeException(ErrorCode.UNSUPPORTED, "The Storm capture service is unavailable");
  }

  public boolean captureSupported() {
    if (server.getPluginManager().getPlugin("TheStorm") == null) return false;
    return mainThread.call(
        () ->
            server
                    .getServicesManager()
                    .load(com.shepherdjerred.thestorm.core.capture.CaptureInspection.class)
                != null,
        MainThread.DEFAULT_TIMEOUT);
  }

  private static byte[] inventoryBytes(Player player) {
    var items =
        java.util.Arrays.stream(player.getInventory().getContents())
            .map(
                item ->
                    item == null
                        ? new org.bukkit.inventory.ItemStack(org.bukkit.Material.AIR)
                        : item)
            .toArray(org.bukkit.inventory.ItemStack[]::new);
    return org.bukkit.inventory.ItemStack.serializeItemsAsBytes(items);
  }

  private JsonObject collectPlayers() {
    JsonArray players = new JsonArray();
    for (Player player : server.getOnlinePlayers()) {
      JsonObject pos = new JsonObject();
      pos.addProperty("x", player.getX());
      pos.addProperty("y", player.getY());
      pos.addProperty("z", player.getZ());
      JsonObject entry = new JsonObject();
      entry.addProperty("name", player.getName());
      entry.addProperty("uuid", player.getUniqueId().toString());
      entry.addProperty("world", player.getWorld().getName());
      entry.add("pos", pos);
      entry.addProperty("gameMode", player.getGameMode().name());
      entry.addProperty("npc", player.hasMetadata("NPC"));
      players.add(entry);
    }
    JsonObject response = new JsonObject();
    response.add("players", players);
    return response;
  }

  /** {@code /v1/command}: dispatches as a console-level sender and captures its feedback. */
  public JsonObject command(String command) {
    String line = command.startsWith("/") ? command.substring(1) : command;
    if (line.isBlank()) {
      throw BridgeException.badRequest("command is blank");
    }
    events.add(EventType.COMMAND, null, "/" + line);
    List<String> output = Collections.synchronizedList(new ArrayList<>());
    boolean success =
        mainThread.call(
            () -> {
              CommandSender sender =
                  server.createCommandSender(component -> output.add(plain(component)));
              return server.dispatchCommand(sender, line);
            },
            MainThread.DEFAULT_TIMEOUT);
    JsonArray lines = new JsonArray();
    synchronized (output) {
      output.forEach(lines::add);
    }
    JsonObject response = new JsonObject();
    response.addProperty("success", success);
    response.add("output", lines);
    return response;
  }

  private static String plain(Component component) {
    return PlainText.strip(PlainTextComponentSerializer.plainText().serialize(component));
  }
}
