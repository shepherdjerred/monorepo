package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.elevator.ElevatorSearch;
import com.shepherdjerred.thestorm.mechanics.domain.elevator.Landing;
import com.shepherdjerred.thestorm.mechanics.domain.elevator.LiftProblem;
import com.shepherdjerred.thestorm.mechanics.domain.elevator.Ride;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerTeleportEvent;

/** Sign elevators: moves the player to the next lift sign's floor. */
final class Elevators {

  private final Kit kit;

  Elevators(Kit kit) {
    this.kit = kit;
  }

  void ride(Player player, PaperGrid grid, Pos sign, Mechanism mechanism) {
    var ride = new Ride(sign, mechanism, PaperGrid.feet(player));
    switch (ElevatorSearch.find(grid, ride, kit.config().elevator().maxDistance())) {
      case Result.Err<Landing, LiftProblem>(var problem) ->
          Replies.error(player, Feature.ELEVATOR, problem.message());
      case Result.Ok<Landing, LiftProblem>(var landing) -> arrive(player, grid, landing);
    }
  }

  private void arrive(Player player, PaperGrid grid, Landing landing) {
    var entry =
        kit.guard()
            .check(player.getUniqueId(), ProtectedAction.TELEPORT_INTO, grid, landing.feet());
    if (entry instanceof Decision.Denied(var reason)) {
      Replies.error(player, Feature.ELEVATOR, reason);
      return;
    }
    var destination = PaperGrid.at(player);
    destination.setY(landing.feet().y());
    player.teleport(destination, PlayerTeleportEvent.TeleportCause.PLUGIN);
    var floor = grid.signAt(landing.sign()).map(view -> view.line(0).strip()).orElse("");
    Replies.info(
        player,
        Feature.ELEVATOR,
        floor.isEmpty() ? "Height " + landing.feet().y() + "." : "Floor: " + floor);
  }
}
