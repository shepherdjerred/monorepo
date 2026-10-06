package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static java.util.Objects.requireNonNull;

import java.util.Locale;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Statistic;
import org.bukkit.WeatherType;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;

/** Player state, world weather/time and announcements. */
final class StaffAdministration {
  private final StaffCommands tools;

  StaffAdministration(StaffCommands tools) {
    this.tools = tools;
  }

  void register() {
    playerState();
    worldState();
    announcements();
    diagnostics();
  }

  private void playerState() {
    tools.add(
        "fly [player]",
        request -> {
          var player = target(request, 0);
          player.setAllowFlight(!player.getAllowFlight());
          if (!player.getAllowFlight()) player.setFlying(false);
          request.say("Flight: " + player.getAllowFlight());
        });
    tools.add(
        "god [player]",
        request -> {
          var player = target(request, 0);
          player.setInvulnerable(!player.isInvulnerable());
          request.say("Invulnerable: " + player.isInvulnerable());
        });
    tools.add(
        "heal [player]",
        request -> {
          var player = target(request, 0);
          var health = requireNonNull(player.getAttribute(Attribute.MAX_HEALTH));
          player.setHealth(health.getValue());
          player.setFireTicks(0);
          request.say("Healed " + player.getName() + ".");
        });
    tools.add(
        "feed [player]",
        request -> {
          var player = target(request, 0);
          player.setFoodLevel(20);
          player.setSaturation(20);
          request.say("Fed " + player.getName() + ".");
        });
    tools.add(
        "speed <0..10> [player]",
        request -> {
          var speed = request.number(0, 0, 10) / 10f;
          var player = target(request, 1);
          if (player.isFlying()) player.setFlySpeed(speed);
          else player.setWalkSpeed(speed);
          request.say("Speed set.");
        });
    tools.add(
        "gamemode <survival|creative|adventure|spectator> [player]",
        request -> {
          var player = target(request, 1);
          player.setGameMode(GameMode.valueOf(request.word(0).toUpperCase(Locale.ROOT)));
          request.say("Game mode set.");
        });
    tools.add(
        "rest [player]",
        request -> {
          var player = target(request, 0);
          player.setStatistic(Statistic.TIME_SINCE_REST, 0);
          request.say("Rest timer reset.");
        });
  }

  private void worldState() {
    tools.add(
        "time <day|night|ticks>",
        request -> {
          var input = request.word(0);
          long ticks =
              switch (input) {
                case "day" -> 1000;
                case "night" -> 13000;
                default -> request.number(0, 0, 24000);
              };
          request.self().getWorld().setTime(ticks);
          request.say("World time set.");
        });
    tools.add("weather <clear|rain> [seconds]", this::weather);
    tools.add(
        "thunder <on|off> [seconds]",
        request -> {
          var world = request.self().getWorld();
          var enabled = bool(request.word(0));
          world.setThundering(enabled);
          world.setThunderDuration(
              request.words().length > 1 ? request.number(1, 1, 3600) * 20 : 6000);
          request.say("Thunder: " + enabled);
        });
    tools.add(
        "ptime <reset|ticks> [player]",
        request -> {
          var player = target(request, 1);
          if ("reset".equals(request.word(0))) player.resetPlayerTime();
          else player.setPlayerTime(request.number(0, 0, 24000), false);
          request.say("Personal time set.");
        });
    tools.add(
        "pweather <reset|clear|rain> [player]",
        request -> {
          var player = target(request, 1);
          switch (request.word(0)) {
            case "reset" -> player.resetPlayerWeather();
            case "clear" -> player.setPlayerWeather(WeatherType.CLEAR);
            case "rain" -> player.setPlayerWeather(WeatherType.DOWNFALL);
            default -> throw new IllegalArgumentException("Use reset, clear or rain.");
          }
          request.say("Personal weather set.");
        });
  }

  private void announcements() {
    tools.add(
        "broadcast <text>",
        request -> {
          request.word(0);
          var message = Component.text("[Announcement] " + request.input());
          for (var player : tools.context.plugin().getServer().getOnlinePlayers())
            player.sendMessage(message);
        });
    tools.add(
        "broadcastworld <text>",
        request -> {
          request.word(0);
          var message = Component.text("[Announcement] " + request.input());
          request.self().getWorld().getPlayers().forEach(player -> player.sendMessage(message));
        });
    tools.add(
        "kickall <reason>",
        request -> {
          request.word(0);
          for (var player : tools.context.plugin().getServer().getOnlinePlayers())
            if (!player.hasPermission("thestorm.essentials.kick.exempt"))
              player.kick(Component.text(request.input()));
        });
    tools.add("suicide", request -> request.self().setHealth(0));
  }

  private void diagnostics() {
    tools.add(
        "ping [player]", request -> request.say("Ping: " + target(request, 0).getPing() + " ms"));
    tools.add(
        "list",
        request ->
            request.say(
                "Online: "
                    + String.join(
                        ", ",
                        tools.context.plugin().getServer().getOnlinePlayers().stream()
                            .filter(
                                player ->
                                    com.shepherdjerred.thestorm.core.players.PlayerVisibility
                                        .visibleTo(request.actor(), player))
                            .map(Player::getName)
                            .sorted()
                            .toList())));
    tools.add(
        "gc",
        request -> {
          var runtime = Runtime.getRuntime();
          request.say(
              "Memory: "
                  + ((runtime.totalMemory() - runtime.freeMemory()) / 1048576)
                  + "/"
                  + runtime.maxMemory() / 1048576
                  + " MiB; TPS: "
                  + java.util.Arrays.toString(tools.context.plugin().getServer().getTPS()));
        });
    tools.add(
        "getpos [player]", request -> request.say(Positions.of(target(request, 0)).describe()));
    tools.add(
        "compass",
        request ->
            request.say(
                "Facing " + request.self().getFacing() + "; yaw " + request.self().getYaw()));
    tools.add(
        "depth",
        request ->
            request.say(
                "Height: "
                    + request.self().getY()
                    + "; world floor: "
                    + request.self().getWorld().getMinHeight()));
    tools.add(
        "playtime [player]",
        request -> {
          var player = target(request, 0);
          request.say(
              player.getName()
                  + ": "
                  + player.getStatistic(Statistic.PLAY_ONE_MINUTE) / 20
                  + " seconds");
        });
    tools.add(
        "essentials status",
        request -> {
          if (!"status".equals(request.word(0)))
            throw new IllegalArgumentException("Use /essentials status.");
          request.say(
              "Staff state: "
                  + tools.state.ready()
                  + "; runtime settings stored in SQLite; config files remain repository-owned.");
        });
  }

  private Player target(StaffCommands.Request request, int index) {
    var player = request.target(index);
    request.others(player);
    return player;
  }

  private void weather(StaffCommands.Request request) {
    boolean storm =
        switch (request.word(0)) {
          case "clear" -> false;
          case "rain" -> true;
          default -> throw new IllegalArgumentException("Use clear or rain.");
        };
    var world = request.self().getWorld();
    world.setStorm(storm);
    world.setWeatherDuration(request.words().length > 1 ? request.number(1, 1, 3600) * 20 : 6000);
    request.say("Weather set.");
  }

  private static boolean bool(String text) {
    return switch (text) {
      case "on" -> true;
      case "off" -> false;
      default -> throw new IllegalArgumentException("Use on or off.");
    };
  }
}
