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

  /** {@code /v1/players}. */
  public JsonObject players() {
    return mainThread.call(this::collectPlayers, MainThread.DEFAULT_TIMEOUT);
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
