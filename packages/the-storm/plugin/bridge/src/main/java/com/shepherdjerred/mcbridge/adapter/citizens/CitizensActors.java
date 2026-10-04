package com.shepherdjerred.mcbridge.adapter.citizens;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.shepherdjerred.mcbridge.adapter.http.Json;
import com.shepherdjerred.mcbridge.adapter.paper.ServerService;
import com.shepherdjerred.mcbridge.adapter.paper.VanillaUse;
import com.shepherdjerred.mcbridge.app.Actors;
import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.ActorName;
import com.shepherdjerred.mcbridge.domain.ActorRequests;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.BridgeEvent;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import java.time.Duration;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.ai.Navigator;
import net.citizensnpcs.api.npc.NPC;
import net.citizensnpcs.api.npc.NPCRegistry;
import net.citizensnpcs.trait.SkinTrait;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/**
 * Test actors as Citizens player NPCs in a private in-memory registry, so they never persist and
 * never mix with server NPCs. Every world call runs on the main thread.
 *
 * <p>What each action fires (verified on Paper 26.2 + Citizens 2.0.44, see the bridge README):
 * {@code command} fires {@link PlayerCommandPreprocessEvent} then {@code performCommand}; {@code
 * chat} calls {@link Player#chat}; {@code break} calls {@link Player#breakBlock}, which fires
 * {@code BlockBreakEvent}; {@code place} sets the block with physics, then fires {@link
 * BlockPlaceEvent} and reverts when it is cancelled; {@code use} fires {@link PlayerInteractEvent}
 * ({@code RIGHT_CLICK_BLOCK}) and, unless a listener denies it, applies the vanilla toggle for
 * doors, trapdoors, fence gates, levers and buttons only; {@code attack} calls {@link
 * LivingEntity#attack}. Feedback messages sent to an actor are not captured: Citizens gives NPCs a
 * network connection that discards packets.
 */
public final class CitizensActors implements Actors {

  private static final String REGISTRY = "mc-harness";
  private static final double NEARBY_RADIUS = 16;
  private static final int NEARBY_LIMIT = 32;
  private static final int REACH = 5;
  private static final int RECENT_EVENTS = 20;
  private static final int ACTION_EVENTS = 50;
  private static final Duration GOTO_SLACK = Duration.ofSeconds(5);
  private static final long STONE_BUTTON_TICKS = 20;
  private static final long WOODEN_BUTTON_TICKS = 30;

  private final Plugin plugin;
  private final ServerService server;
  private final MainThread mainThread;
  private final EventRing events;
  private final NPCRegistry registry;
  private final Map<ActorName, Actor> actors = new LinkedHashMap<>();
  private final NamespacedKey actorKey;

  private record SpawnChunk(World world, int x, int z) {}

  private record Actor(NPC npc, boolean op, SpawnChunk chunk) {}

  private CitizensActors(
      Plugin plugin,
      ServerService server,
      MainThread mainThread,
      EventRing events,
      NPCRegistry registry) {
    this.plugin = plugin;
    this.server = server;
    this.mainThread = mainThread;
    this.events = events;
    this.registry = registry;
    this.actorKey = new NamespacedKey(plugin, "actor");
  }

  /** Creates the Citizens-backed actors. Call only when Citizens is enabled. */
  public static Actors create(
      Plugin plugin, ServerService server, MainThread mainThread, EventRing events) {
    NPCRegistry stale = CitizensAPI.getNamedNPCRegistry(REGISTRY);
    if (stale != null) {
      stale.deregisterAll();
      CitizensAPI.removeNamedNPCRegistry(REGISTRY);
    }
    return new CitizensActors(
        plugin, server, mainThread, events, CitizensAPI.createInMemoryNPCRegistry(REGISTRY));
  }

  @Override
  public boolean supported() {
    return true;
  }

  @Override
  public JsonObject spawn(ActorRequests.Spawn spawn) {
    return mainThread.call(() -> spawnNow(spawn), MainThread.DEFAULT_TIMEOUT);
  }

  private JsonObject spawnNow(ActorRequests.Spawn spawn) {
    ActorName name = spawn.name();
    if (actors.containsKey(name)) {
      throw BridgeException.badRequest("actor " + name.value() + " already exists");
    }
    if (plugin.getServer().getPlayerExact(name.value()) != null) {
      throw BridgeException.badRequest("a player named " + name.value() + " is online");
    }
    World world = server.world(spawn.world());
    BlockPos at = spawn.at();
    // Paper 26.x keeps no chunks loaded without players, and Citizens despawns an NPC whose
    // chunk unloads. Citizens' keep-loaded flag follows the NPC but takes effect a tick late, so
    // the bridge also holds the spawn chunk for the actor's lifetime.
    SpawnChunk chunk = new SpawnChunk(world, at.x() >> 4, at.z() >> 4);
    world.addPluginChunkTicket(chunk.x(), chunk.z(), plugin);
    NPC npc = registry.createNPC(EntityType.PLAYER, name.value());
    npc.setProtected(false);
    npc.data().set(NPC.Metadata.KEEP_CHUNK_LOADED, true);
    // Citizens otherwise looks up a skin for the name and respawns the NPC when it arrives,
    // cancelling whatever the actor was doing (observed as goto: npc_despawned).
    SkinTrait skin = npc.getOrAddTrait(SkinTrait.class);
    skin.setFetchDefaultSkin(false);
    skin.setShouldUpdateSkins(false);
    if (!npc.spawn(center(world, at)) || !(npc.getEntity() instanceof Player player)) {
      npc.destroy();
      world.removePluginChunkTicket(chunk.x(), chunk.z(), plugin);
      throw new BridgeException(ErrorCode.INTERNAL, "Citizens could not spawn " + name.value());
    }
    player.getPersistentDataContainer().set(actorKey, PersistentDataType.BOOLEAN, true);
    player.setGameMode(GameMode.valueOf(spawn.mode().name()));
    if (spawn.op()) {
      player.setOp(true);
    }
    Actor actor = new Actor(npc, spawn.op(), chunk);
    actors.put(name, actor);
    events.add(
        EventType.ACTOR,
        name.value(),
        "spawned at " + at.x() + "," + at.y() + "," + at.z() + " in " + world.getName());
    return describe(name, actor, player);
  }

  @Override
  public JsonObject list() {
    return mainThread.call(
        () -> {
          JsonArray list = new JsonArray();
          for (Map.Entry<ActorName, Actor> entry : actors.entrySet()) {
            list.add(describe(entry.getKey(), entry.getValue(), player(entry.getKey())));
          }
          JsonObject response = new JsonObject();
          response.add("actors", list);
          return response;
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  @Override
  public JsonObject observe(ActorName name) {
    return mainThread.call(() -> observeNow(name), MainThread.DEFAULT_TIMEOUT);
  }

  private JsonObject observeNow(ActorName name) {
    Actor actor = require(name);
    Player player = player(name);
    Location location = location(player);
    JsonObject response = new JsonObject();
    response.add("actor", describe(name, actor, player));
    response.addProperty("yaw", location.getYaw());
    response.addProperty("pitch", location.getPitch());
    response.addProperty("health", player.getHealth());
    response.addProperty("food", player.getFoodLevel());
    PlayerInventory inventory = player.getInventory();
    ItemStack held = inventory.getItemInMainHand();
    if (held.getType().isAir()) {
      response.add("heldItem", JsonNull.INSTANCE);
    } else {
      response.add("heldItem", item(held));
    }
    JsonArray slots = new JsonArray();
    for (int slot = 0; slot < inventory.getSize(); slot++) {
      ItemStack stack = inventory.getItem(slot);
      if (stack != null && !stack.getType().isAir()) {
        JsonObject entry = item(stack);
        entry.addProperty("slot", slot);
        slots.add(entry);
      }
    }
    response.add("inventory", slots);
    Block target = player.getTargetBlockExact(REACH);
    if (target == null) {
      response.add("lookingAt", JsonNull.INSTANCE);
    } else {
      JsonObject looking = new JsonObject();
      looking.add("pos", Json.pos(pos(target)));
      looking.addProperty("state", target.getBlockData().getAsString());
      response.add("lookingAt", looking);
    }
    response.add("nearby", nearby(player));
    response.add("events", eventsJson(events.recentFor(name.value(), RECENT_EVENTS)));
    return response;
  }

  @Override
  public JsonObject remove(ActorName name) {
    return mainThread.call(
        () -> {
          Actor actor = require(name);
          destroy(actor);
          actors.remove(name);
          events.add(EventType.ACTOR, name.value(), "removed");
          JsonObject response = new JsonObject();
          response.addProperty("removed", name.value());
          return response;
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  @Override
  public JsonObject goTo(ActorName name, ActorRequests.Goto request) {
    long before = events.cursor();
    String outcome =
        mainThread.callAsync(
            () -> startNavigation(name, request), request.timeout().plus(GOTO_SLACK));
    boolean arrived = "arrived".equals(outcome);
    return mainThread.call(
        () -> {
          Actor actor = require(name);
          if (!arrived) {
            actor.npc().getNavigator().cancelNavigation();
          }
          events.add(
              EventType.ACTOR, name.value(), "goto " + format(request.pos()) + ": " + outcome);
          return result(name, before, arrived, "goto " + format(request.pos()) + ": " + outcome);
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  private CompletableFuture<String> startNavigation(ActorName name, ActorRequests.Goto request) {
    require(name);
    Player player = player(name);
    Location target = center(player.getWorld(), request.pos());
    CompletableFuture<String> outcome = new CompletableFuture<>();
    if (location(player).distance(target) <= request.range()) {
      outcome.complete("arrived");
      return outcome;
    }
    Navigator navigator = require(name).npc().getNavigator();
    navigator.setTarget(target);
    if (!navigator.isNavigating()) {
      outcome.complete("no path");
      return outcome;
    }
    // Local parameters belong to the target just set; the callback's reason is null on arrival.
    navigator
        .getLocalParameters()
        .distanceMargin(request.range())
        .addSingleUseCallback(
            reason ->
                outcome.complete(
                    reason == null ? "arrived" : reason.name().toLowerCase(Locale.ROOT)));
    return outcome.completeOnTimeout(
        "timeout", request.timeout().toMillis(), TimeUnit.MILLISECONDS);
  }

  @Override
  public JsonObject look(ActorName name, BlockPos pos) {
    return act(
        name,
        player -> {
          require(name).npc().faceLocation(center(player.getWorld(), pos));
          return new Outcome(true, "looking at " + format(pos));
        });
  }

  @Override
  public JsonObject equip(ActorName name, ActorRequests.Equip equip) {
    return act(
        name,
        player -> {
          Material material = Material.matchMaterial(equip.item());
          if (material == null || !material.isItem() || material.isAir()) {
            throw BridgeException.badRequest("not an item: " + equip.item());
          }
          if (equip.count() > material.getMaxStackSize()) {
            throw BridgeException.badRequest(
                equip.item() + " stacks to " + material.getMaxStackSize());
          }
          ItemStack stack = new ItemStack(material, equip.count());
          PlayerInventory inventory = player.getInventory();
          switch (equip.slot()) {
            case HAND -> inventory.setItemInMainHand(stack);
            case OFFHAND -> inventory.setItemInOffHand(stack);
            case HEAD -> inventory.setHelmet(stack);
            case CHEST -> inventory.setChestplate(stack);
            case LEGS -> inventory.setLeggings(stack);
            case FEET -> inventory.setBoots(stack);
          }
          return new Outcome(
              true,
              "equipped "
                  + equip.count()
                  + " "
                  + material.getKey().asString()
                  + " in "
                  + equip.slot().name().toLowerCase(Locale.ROOT));
        });
  }

  @Override
  public JsonObject command(ActorName name, String command) {
    String line = command.startsWith("/") ? command.substring(1) : command;
    if (line.isBlank()) {
      throw BridgeException.badRequest("command is blank");
    }
    return act(
        name,
        player -> {
          // A typed command fires PlayerCommandPreprocessEvent before dispatch; performCommand
          // alone does not, so fire it to reach listeners exactly as a real player would.
          PlayerCommandPreprocessEvent event = new PlayerCommandPreprocessEvent(player, "/" + line);
          plugin.getServer().getPluginManager().callEvent(event);
          if (event.isCancelled()) {
            return new Outcome(false, "a PlayerCommandPreprocessEvent listener cancelled /" + line);
          }
          String dispatched =
              event.getMessage().startsWith("/")
                  ? event.getMessage().substring(1)
                  : event.getMessage();
          boolean known = player.performCommand(dispatched);
          return new Outcome(
              known,
              (known ? "dispatched /" : "the server did not run /")
                  + dispatched
                  + " (feedback to the actor is not captured)");
        });
  }

  @Override
  public JsonObject chat(ActorName name, ActorRequests.Chat chat) {
    return act(
        name,
        player -> {
          player.chat(chat.message());
          return new Outcome(true, "sent chat");
        });
  }

  @Override
  public JsonObject breakBlock(ActorName name, BlockPos pos) {
    return act(
        name,
        player -> {
          Block block = player.getWorld().getBlockAt(pos.x(), pos.y(), pos.z());
          String before = block.getBlockData().getAsString();
          if (block.getType().isAir()) {
            return new Outcome(false, "nothing to break at " + format(pos));
          }
          boolean broken = player.breakBlock(block);
          return new Outcome(
              broken,
              broken
                  ? "broke " + before + " at " + format(pos)
                  : "breaking "
                      + before
                      + " was refused (cancelled, protected, or unbreakable in this game mode)");
        });
  }

  @Override
  public JsonObject place(ActorName name, BlockPos pos, String blockState) {
    return act(
        name,
        player -> {
          BlockData data;
          try {
            data = plugin.getServer().createBlockData(blockState);
          } catch (IllegalArgumentException e) {
            throw BridgeException.badRequest("not a block state: " + blockState);
          }
          Block block = player.getWorld().getBlockAt(pos.x(), pos.y(), pos.z());
          if (!block.isReplaceable()) {
            return new Outcome(
                false, format(pos) + " is occupied by " + block.getBlockData().getAsString());
          }
          BlockState replaced = block.getState();
          block.setBlockData(data, true);
          BlockPlaceEvent event =
              new BlockPlaceEvent(
                  block,
                  replaced,
                  block.getRelative(BlockFace.DOWN),
                  new ItemStack(data.getPlacementMaterial()),
                  player,
                  true,
                  EquipmentSlot.HAND);
          plugin.getServer().getPluginManager().callEvent(event);
          if (event.isCancelled() || !event.canBuild()) {
            replaced.update(true, false);
            return new Outcome(false, "a BlockPlaceEvent listener cancelled placing " + blockState);
          }
          return new Outcome(
              true, "placed " + block.getBlockData().getAsString() + " at " + format(pos));
        });
  }

  @Override
  public JsonObject use(ActorName name, BlockPos pos) {
    return act(
        name,
        player -> {
          Block block = player.getWorld().getBlockAt(pos.x(), pos.y(), pos.z());
          String state = block.getBlockData().getAsString();
          ItemStack hand = player.getInventory().getItemInMainHand();
          PlayerInteractEvent event =
              new PlayerInteractEvent(
                  player,
                  Action.RIGHT_CLICK_BLOCK,
                  hand.getType().isAir() ? null : hand,
                  block,
                  faceToward(block, player.getEyeLocation()),
                  EquipmentSlot.HAND);
          plugin.getServer().getPluginManager().callEvent(event);
          // DENY is ambiguous: plugins that handle a click (e.g. sign mechanisms) cancel it to
          // suppress the vanilla result, exactly like a protection plugin refusing it. The event
          // was delivered either way, so the action succeeds and the scenario asserts effects.
          if (event.useInteractedBlock() == Event.Result.DENY) {
            return new Outcome(
                true,
                "interact event fired on "
                    + state
                    + "; a listener cancelled the vanilla use (handled it or refused it)");
          }
          @Nullable String vanilla = VanillaUse.apply(plugin, block, buttonTicks(block));
          return new Outcome(
              true,
              "interact event fired on "
                  + state
                  + "; "
                  + (vanilla == null ? "no vanilla behavior simulated" : vanilla));
        });
  }

  @Override
  public JsonObject attack(ActorName name, ActorRequests.AttackTarget target) {
    return act(
        name,
        player -> {
          Entity victim = victim(player, target);
          String label = victim.getType().getKey().asString() + " " + victim.getUniqueId();
          double before = victim instanceof LivingEntity living ? living.getHealth() : Double.NaN;
          player.attack(victim);
          String health =
              victim instanceof LivingEntity living
                  ? " (health " + before + " -> " + living.getHealth() + ")"
                  : "";
          return new Outcome(true, "attacked " + label + health);
        });
  }

  @Override
  public void shutdown() {
    for (Actor actor : actors.values()) {
      destroy(actor);
    }
    actors.clear();
    registry.deregisterAll();
    CitizensAPI.removeNamedNPCRegistry(REGISTRY);
  }

  /** The outcome of one action, before it is wrapped with position and events. */
  private record Outcome(boolean ok, String detail) {}

  @FunctionalInterface
  private interface ActorAction {
    Outcome run(Player player);
  }

  private JsonObject act(ActorName name, ActorAction action) {
    long before = events.cursor();
    return mainThread.call(
        () -> {
          require(name);
          Outcome outcome = action.run(player(name));
          return result(name, before, outcome.ok(), outcome.detail());
        },
        MainThread.DEFAULT_TIMEOUT);
  }

  private JsonObject result(ActorName name, long before, boolean ok, String detail) {
    JsonObject response = new JsonObject();
    response.addProperty("ok", ok);
    response.addProperty("detail", detail);
    response.add("pos", vec(location(player(name))));
    response.add("events", eventsJson(events.since(before, ACTION_EVENTS).events()));
    return response;
  }

  private Actor require(ActorName name) {
    Actor actor = actors.get(name);
    if (actor == null) {
      throw new BridgeException(ErrorCode.NOT_FOUND, "no actor named " + name.value());
    }
    return actor;
  }

  private Player player(ActorName name) {
    if (require(name).npc().getEntity() instanceof Player player) {
      return player;
    }
    throw new BridgeException(
        ErrorCode.INTERNAL, "actor " + name.value() + " is not spawned (Citizens despawned it)");
  }

  private void destroy(Actor actor) {
    if (actor.op() && actor.npc().getEntity() instanceof Player player) {
      player.setOp(false);
    }
    actor.npc().destroy();
    SpawnChunk chunk = actor.chunk();
    chunk.world().removePluginChunkTicket(chunk.x(), chunk.z(), plugin);
  }

  private JsonObject describe(ActorName name, Actor actor, Player player) {
    JsonObject object = new JsonObject();
    object.addProperty("name", name.value());
    object.addProperty("uuid", player.getUniqueId().toString());
    object.addProperty("world", player.getWorld().getName());
    object.add("pos", vec(location(player)));
    object.addProperty("gameMode", player.getGameMode().name());
    object.addProperty("op", actor.op());
    return object;
  }

  private JsonArray nearby(Player player) {
    Location origin = location(player);
    List<Entity> entities =
        player.getNearbyEntities(NEARBY_RADIUS, NEARBY_RADIUS, NEARBY_RADIUS).stream()
            .sorted(Comparator.comparingDouble(entity -> entity.getLocation().distance(origin)))
            .limit(NEARBY_LIMIT)
            .toList();
    JsonArray array = new JsonArray();
    for (Entity entity : entities) {
      JsonObject entry = new JsonObject();
      entry.addProperty("type", entity.getType().getKey().asString());
      if (entity instanceof Player other) {
        entry.addProperty("name", other.getName());
      } else {
        entry.add("name", JsonNull.INSTANCE);
      }
      entry.addProperty("uuid", entity.getUniqueId().toString());
      entry.add("pos", vec(entity.getLocation()));
      entry.addProperty("distance", round(entity.getLocation().distance(origin)));
      entry.addProperty("player", entity instanceof Player);
      entry.addProperty("actor", entity.getPersistentDataContainer().has(actorKey));
      array.add(entry);
    }
    return array;
  }

  private Entity victim(Player player, ActorRequests.AttackTarget target) {
    return switch (target) {
      case ActorRequests.AttackTarget.ById byId -> {
        Entity entity = plugin.getServer().getEntity(byId.id());
        if (entity == null || !entity.getWorld().equals(player.getWorld())) {
          throw new BridgeException(
              ErrorCode.NOT_FOUND, "no entity " + byId.id() + " in " + player.getWorld().getName());
        }
        if (entity.equals(player)) {
          throw BridgeException.badRequest("an actor cannot attack itself");
        }
        yield entity;
      }
      case ActorRequests.AttackTarget.NearestOfType ofType -> {
        NamespacedKey key = NamespacedKey.fromString(ofType.type());
        EntityType type = key == null ? null : Registry.ENTITY_TYPE.get(key);
        if (type == null) {
          throw BridgeException.badRequest("not an entity type: " + ofType.type());
        }
        Location origin = location(player);
        yield player.getNearbyEntities(NEARBY_RADIUS, NEARBY_RADIUS, NEARBY_RADIUS).stream()
            .filter(entity -> entity.getType() == type)
            .min(Comparator.comparingDouble(entity -> entity.getLocation().distance(origin)))
            .orElseThrow(
                () ->
                    new BridgeException(
                        ErrorCode.NOT_FOUND,
                        "no " + ofType.type() + " within " + (int) NEARBY_RADIUS + " blocks"));
      }
    };
  }

  private static long buttonTicks(Block block) {
    return block.getType().getKey().getKey().contains("stone")
        ? STONE_BUTTON_TICKS
        : WOODEN_BUTTON_TICKS;
  }

  /** The block face that points from {@code block} toward {@code eye}. */
  private static BlockFace faceToward(Block block, Location eye) {
    double dx = eye.getX() - (block.getX() + 0.5);
    double dy = eye.getY() - (block.getY() + 0.5);
    double dz = eye.getZ() - (block.getZ() + 0.5);
    double ax = Math.abs(dx);
    double ay = Math.abs(dy);
    double az = Math.abs(dz);
    if (ay >= ax && ay >= az) {
      return dy >= 0 ? BlockFace.UP : BlockFace.DOWN;
    }
    if (ax >= az) {
      return dx >= 0 ? BlockFace.EAST : BlockFace.WEST;
    }
    return dz >= 0 ? BlockFace.SOUTH : BlockFace.NORTH;
  }

  private static JsonArray eventsJson(List<BridgeEvent> list) {
    JsonArray array = new JsonArray();
    for (BridgeEvent event : list) {
      array.add(Json.event(event));
    }
    return array;
  }

  private static JsonObject item(ItemStack stack) {
    JsonObject object = new JsonObject();
    object.addProperty("item", stack.getType().getKey().asString());
    object.addProperty("count", stack.getAmount());
    return object;
  }

  /**
   * An entity's location. {@code Player} also inherits {@code OfflinePlayer#getLocation}, which is
   * nullable for offline players; through {@code Entity} it never is.
   */
  private static Location location(Entity entity) {
    return entity.getLocation();
  }

  private static Location center(World world, BlockPos pos) {
    return new Location(world, pos.x() + 0.5, pos.y(), pos.z() + 0.5);
  }

  private static BlockPos pos(Block block) {
    return new BlockPos(block.getX(), block.getY(), block.getZ());
  }

  private static String format(BlockPos pos) {
    return pos.x() + "," + pos.y() + "," + pos.z();
  }

  private static JsonObject vec(Location location) {
    JsonObject object = new JsonObject();
    object.addProperty("x", round(location.getX()));
    object.addProperty("y", round(location.getY()));
    object.addProperty("z", round(location.getZ()));
    return object;
  }

  private static double round(double value) {
    return Math.round(value * 100.0) / 100.0;
  }
}
