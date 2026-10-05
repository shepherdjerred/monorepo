package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.app.TpaDesk;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaError;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest;
import java.util.List;

/** Immediate, free administrative movement; ordinary moves still consult protection and guards. */
final class StaffTravel {
  private final StaffCommands tools;
  private final EssentialsPaper.App app;
  private final TpaDesk tpa;

  StaffTravel(StaffCommands tools, EssentialsPaper.App app, TpaDesk tpa) {
    this.tools = tools;
    this.app = app;
    this.tpa = tpa;
  }

  void register() {
    tools.permission("teleport.override");
    for (var name : List.of("tp", "tpo"))
      tools.add(name + " <player> [destination]", request -> toPlayer(request, "tpo".equals(name)));
    for (var name : List.of("tphere", "tpohere"))
      tools.add(
          name + " <player>",
          request ->
              tools.teleport(
                  request,
                  tools.player(request.actor(), request.word(0)),
                  Positions.current(request.self()),
                  "tpohere".equals(name)));
    tools.add("tppos <x> <y> <z> [world]", this::coordinates);
    tools.add(
        "tpall",
        request -> {
          var destination = Positions.current(request.self());
          for (var player : tools.context.plugin().getServer().getOnlinePlayers())
            if (!player.equals(request.actor()))
              tools.teleport(request, player, destination, false);
        });
    tools.add("tpoffline <username>", this::offline);
    tools.add(
        "world <name>",
        request -> {
          var world = tools.context.plugin().getServer().getWorld(request.word(0));
          if (world == null) throw new IllegalArgumentException("World is not loaded.");
          tools.teleport(request, request.self(), world.getSpawnLocation(), false);
        });
    tools.add(
        "tpacancel",
        request -> {
          tpa.forget(request.self().getUniqueId());
          request.say("Your requests were cancelled.");
        });
    tools.add(
        "tpauto",
        request ->
            request.say(
                "Automatic request acceptance: " + tpa.toggleAuto(request.self().getUniqueId())));
    tools.add("tpaall", this::requestAll);
    places();
  }

  private void requestAll(StaffCommands.Request request) {
    var self = request.self();
    int sent = 0;
    for (var player : tools.context.plugin().getServer().getOnlinePlayers()) {
      if (player.equals(self)
          || !com.shepherdjerred.thestorm.core.players.PlayerVisibility.visibleTo(self, player))
        continue;
      switch (tpa.sendStaff(self.getUniqueId(), player.getUniqueId())) {
        case Result.Ok<TpaRequest, TpaError>(var pending) -> {
          var exact = self.getName() + " " + pending.id();
          player.sendMessage(
              net.kyori.adventure.text.Component.text(
                      self.getName() + " wants you to teleport to them. ")
                  .append(
                      net.kyori.adventure.text.Component.text("[Accept]")
                          .clickEvent(
                              net.kyori.adventure.text.event.ClickEvent.runCommand(
                                  "/tpaccept " + exact)))
                  .append(
                      net.kyori.adventure.text.Component.text(" [Deny]")
                          .clickEvent(
                              net.kyori.adventure.text.event.ClickEvent.runCommand(
                                  "/tpdeny " + exact))));
          sent++;
        }
        case Result.Err<TpaRequest, TpaError> _ ->
            request.say(player.getName() + " is not accepting this request.");
      }
    }
    request.say("Sent " + sent + " teleport requests.");
  }

  private void places() {
    tools.add("renamehome <old> <new>", this::renameHome);
    tools.add(
        "warpinfo <name>",
        request -> {
          var name = name(request.word(0));
          tools.complete(
              request.actor(),
              app.warps().findReady(name),
              warp ->
                  request.say(
                      warp.map(value -> value.position().describe()).orElse("Unknown warp.")));
        });
    tools.add("setspawn", request -> savePlace(request, "spawn", "default"));
    tools.add("settpr", request -> savePlace(request, "rtp", request.self().getWorld().getName()));
    for (var name : List.of("top", "bottom", "jump"))
      tools.add(name, request -> vertical(request, name));
  }

  private void toPlayer(StaffCommands.Request request, boolean override) {
    var first = tools.player(request.actor(), request.word(0));
    var mover = request.words().length > 1 ? first : request.self();
    var target =
        request.words().length > 1 ? tools.player(request.actor(), request.word(1)) : first;
    request.others(mover);
    tools.teleport(request, mover, Positions.current(target), override);
  }

  private void coordinates(StaffCommands.Request request) {
    var self = request.self();
    var world =
        request.words().length > 3
            ? tools.context.plugin().getServer().getWorld(request.word(3))
            : self.getWorld();
    if (world == null) throw new IllegalArgumentException("World is not loaded.");
    var position =
        new Position(
            world.getName(),
            Double.parseDouble(request.word(0)),
            Double.parseDouble(request.word(1)),
            Double.parseDouble(request.word(2)),
            self.getYaw(),
            self.getPitch());
    tools.teleport(
        request,
        self,
        Positions.toLocation(tools.context.plugin().getServer(), position).orElseThrow(),
        false);
  }

  private void offline(StaffCommands.Request request) {
    var known =
        app.players()
            .find(request.word(0))
            .orElseThrow(() -> new IllegalArgumentException("Unknown username."));
    var session =
        tools
            .state
            .find("session", known.uuid().toString(), StaffState.Session.class)
            .orElseThrow(() -> new IllegalArgumentException("No stored logout location."));
    var destination =
        Positions.toLocation(tools.context.plugin().getServer(), session.position())
            .orElseThrow(() -> new IllegalArgumentException("World is not loaded."));
    tools.teleport(request, request.self(), destination, false);
  }

  private void savePlace(StaffCommands.Request request, String kind, String key) {
    var location = Positions.current(request.self());
    if (!SafeLocations.isSafe(location))
      throw new IllegalArgumentException("Stand at a safe location first.");
    request.save(
        List.of(tools.state.entry(kind, key, Positions.of(location))),
        () -> request.say("Saved " + kind + " at " + Positions.of(location).describe() + "."));
  }

  private void vertical(StaffCommands.Request request, String command) {
    var player = request.self();
    var location = Positions.current(player);
    if ("jump".equals(command)) {
      var block = player.getTargetBlockExact(100);
      if (block == null) throw new IllegalArgumentException("Look at a nearby block.");
      location = block.getLocation().add(.5, 1, .5);
    } else {
      int from =
          "top".equals(command)
              ? player.getWorld().getMaxHeight() - 2
              : player.getWorld().getMinHeight() + 1;
      int step = "top".equals(command) ? -1 : 1;
      while (from > player.getWorld().getMinHeight()
          && from < player.getWorld().getMaxHeight() - 1) {
        location.setY(from);
        if (SafeLocations.isSafe(location)) break;
        from += step;
      }
    }
    var safe =
        SafeLocations.nearestSafe(location)
            .orElseThrow(() -> new IllegalArgumentException("No safe landing found."));
    tools.teleport(request, player, safe, false);
  }

  private void renameHome(StaffCommands.Request request) {
    var id = request.self().getUniqueId();
    var old = name(request.word(0));
    var next = name(request.word(1));
    tools.complete(
        request.actor(),
        app.stores().homes().rename(id, old, next),
        renamed ->
            request.say(
                renamed ? "Home renamed." : "Old home is missing or new name is already used."));
  }

  private static PlaceName name(String value) {
    return switch (PlaceName.parse(value)) {
      case Result.Ok<PlaceName, String>(var name) -> name;
      case Result.Err<PlaceName, String>(var error) -> throw new IllegalArgumentException(error);
    };
  }
}
