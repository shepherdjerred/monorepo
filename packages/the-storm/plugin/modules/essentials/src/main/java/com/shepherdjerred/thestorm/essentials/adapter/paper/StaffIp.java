package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.players.ForwardedClients;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import net.kyori.adventure.text.Component;

/** IP moderation is available only for verified public client addresses. */
final class StaffIp {
  private final StaffCommands tools;
  final ForwardedClients clients;

  StaffIp(StaffCommands tools) {
    this.tools = tools;
    clients =
        new ForwardedClients(
            tools.context.services().require(ManagedGameplay.class),
            tools.state::ready,
            address ->
                tools
                    .state
                    .find("ip-ban", address, StaffState.IpBan.class)
                    .filter(
                        ban ->
                            ban.active() && tools.context.time().instant().isBefore(ban.expires()))
                    .map(ban -> "IP banned: " + ban.reason()));
  }

  void register() {
    tools.add("banip <address|online-player> <reason>", request -> gated(request, false));
    tools.add(
        "tempbanip <address|online-player> <duration> <reason>", request -> gated(request, true));
    tools.add(
        "unbanip <address>",
        request -> {
          var address =
              ForwardedClients.publicAddress(request.word(0))
                  .orElseThrow(() -> new IllegalArgumentException("Use a public IP address."));
          request.save(
              List.of(
                  tools.state.entry(
                      "ip-ban", address, new StaffState.IpBan(Instant.MAX, "unbanned", false))),
              () -> request.say("IP ban removed."));
        });
  }

  private void gated(StaffCommands.Request request, boolean temporary) {
    var id = request.self().getUniqueId();
    tools.complete(
        request.actor(),
        tools.context.services().require(ManagedGameplay.class).enabled(ManagedGameplay.IP, id),
        enabled -> {
          if (!enabled) throw new IllegalArgumentException("IP moderation is not enabled.");
          ban(request, temporary);
        });
  }

  private void ban(StaffCommands.Request request, boolean temporary) {
    var literal = ForwardedClients.publicAddress(request.word(0));
    var address =
        literal.orElseGet(
            () ->
                clients
                    .verified(tools.player(request.actor(), request.word(0)).getUniqueId())
                    .orElseThrow(
                        () ->
                            new IllegalArgumentException(
                                "That player has no verified public client IP.")));
    var expires =
        temporary ? tools.context.time().instant().plus(duration(request.word(1))) : Instant.MAX;
    int reasonIndex = temporary ? 2 : 1;
    request.word(reasonIndex);
    var reason = request.input().trim().split("\\s+", reasonIndex + 1)[reasonIndex];
    request.save(
        List.of(tools.state.entry("ip-ban", address, new StaffState.IpBan(expires, reason, true))),
        () -> {
          for (var player : tools.context.plugin().getServer().getOnlinePlayers())
            if (clients.verified(player.getUniqueId()).filter(address::equals).isPresent())
              player.kick(Component.text("IP banned: " + reason));
          request.say("IP ban saved.");
        });
  }

  private static Duration duration(String text) {
    return switch (DurationText.parse(text)) {
      case Result.Ok<Duration, String>(var value) -> value;
      case Result.Err<Duration, String>(var error) -> throw new IllegalArgumentException(error);
    };
  }
}
