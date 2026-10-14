package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.rwf.app.map.MapRotation;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/** Owns candidate terrain, independent visits, menu generations and evacuation before release. */
final class CandidateVisits {
  static final Duration VOTING_LENGTH = Duration.ofSeconds(90);
  static final int MAP_MENU_SLOT = 5;
  private final MatchRunner runner;
  private final PaperContext context;
  private final MapRotation<MapWorld> rotation;
  private final Keys keys;
  private final Map<UUID, String> candidateVisitors = new HashMap<>();
  private final Map<UUID, Integer> candidateMemberships = new HashMap<>();
  private int candidateMembershipSerial;
  private int candidateGeneration;
  private boolean candidatePreparationFailed;

  CandidateVisits(
      MatchRunner runner, PaperContext context, MapRotation<MapWorld> rotation, Keys keys) {
    this.runner = runner;
    this.context = context;
    this.rotation = rotation;
    this.keys = keys;
  }

  boolean failed() {
    return candidatePreparationFailed;
  }

  boolean visiting(UUID player) {
    return candidateVisitors.containsKey(player);
  }

  void joined(MatchEvent event) {
    if (event instanceof MatchEvent.Join join && !join.id().isBot()) {
      candidateMemberships.put(join.id().uuid(), ++candidateMembershipSerial);
    }
  }

  void forget(CombatantId id) {
    candidateVisitors.remove(id.uuid());
    candidateMemberships.remove(id.uuid());
  }

  void afterStep(MatchEvent event) {
    if (event instanceof MatchEvent.BallotOpened && enabled()) prepare();
    if (event instanceof MatchEvent.Stop) cancel();
    if (event instanceof MatchEvent.MapQuarantined
        && runner.match().ballot().filter(ballot -> ballot.opened() && !ballot.closed()).isPresent()
        && enabled()) prepare();
  }

  void selecting() {
    candidateGeneration++;
    evacuateVisitors();
    evacuateWatchers();
  }

  boolean enabled() {
    return runner.features().matchFlow() && runner.features().candidateVisits();
  }

  void prepare() {
    candidateGeneration++;
    evacuateVisitors();
    evacuateWatchers();
    runner.clearCurrentMapForVisits();
    var generation = candidateGeneration;
    var ballot = runner.match().ballot().orElseThrow();
    var ids = ballot.candidates().stream().map(Ballot.Candidate::mapId).toList();
    var candidates = ids.stream().map(id -> rotation.byId(id).orElseThrow()).toList();
    rotation.prepareCandidates(
        candidates,
        ok -> {
          if (generation != candidateGeneration
              || !runner.ready()
              || runner
                  .match()
                  .ballot()
                  .filter(
                      vote ->
                          !vote.closed()
                              && vote.candidates().stream()
                                  .map(Ballot.Candidate::mapId)
                                  .toList()
                                  .equals(ids))
                  .isEmpty()) return;
          if (ok) {
            runner.handle(new MatchEvent.CandidatesReady(ids, runner.now()));
            runner
                .humanEntities()
                .forEach(
                    player ->
                        Texts.info(
                            player,
                            "Candidate maps are ready. Visit and vote with /rwf maps; voting stays open for 90 seconds."));
          } else {
            abort();
          }
        });
  }

  void abort() {
    runner
        .humanEntities()
        .forEach(
            player ->
                Texts.error(
                    player,
                    "A candidate map could not be prepared. This ballot was aborted; rejoin after an operator checks the map."));
    cancel();
    candidatePreparationFailed = true;
    runner.closeCandidateAdmission();
    runner.handle(new MatchEvent.Stop());
  }

  void cancel() {
    candidateGeneration++;
    evacuateVisitors();
    evacuateWatchers();
    rotation.cancelVisits();
  }

  private void evacuateWatchers() {
    for (var player : List.copyOf(context.mapWorld().getPlayers())) {
      if (player.getGameMode() == GameMode.SPECTATOR) {
        player.setSpectatorTarget(null);
        runner.move(player, runner.lobby());
      }
    }
  }

  void giveMenu(Player player) {
    if (!enabled()) return;
    var item =
        CandidateMenu.item(
            Material.FILLED_MAP,
            "Visit maps and vote",
            List.of(
                "Fly over candidates, vote, return or switch map", "Right-click or use /rwf maps"));
    keys.tagMapMenu(item);
    player.getInventory().setItem(MAP_MENU_SLOT, item);
  }

  void open(Player player) {
    if (!enabled() || !player.isOnline() || runner.memberOf(player.getUniqueId()).isEmpty()) return;
    var ballot = runner.match().ballot().filter(Ballot::opened);
    if (ballot.isEmpty()) {
      Texts.info(player, "No candidate vote is open. Use /rwf return to return from a visit.");
      return;
    }
    var view = ballot.orElseThrow();
    var membership =
        requireNonNull(
            candidateMemberships.get(player.getUniqueId()),
            "every admitted human has a candidate visit ticket");
    player.openInventory(
        new CandidateMenu(
                context.server(),
                new CandidateMenu.Request(
                    candidateGeneration,
                    membership,
                    view,
                    view.candidates().stream()
                        .map(candidate -> rotation.byId(candidate.mapId()).orElseThrow())
                        .toList()))
            .getInventory());
  }

  void action(Player player, CandidateMenu menu, int slot) {
    if (!enabled()
        || !player.isOnline()
        || runner.memberOf(player.getUniqueId()).isEmpty()
        || menu.generation() != candidateGeneration
        || !Integer.valueOf(menu.membership())
            .equals(candidateMemberships.get(player.getUniqueId()))) return;
    if (slot == CandidateMenu.RETURN) {
      player.closeInventory();
      returnToLobby(player);
    } else if (slot == CandidateMenu.KITS) {
      runner.picker().open(player).ifPresent(refusal -> Texts.error(player, refusal));
    } else {
      for (var index = 0; index < menu.maps().size(); index++) {
        var column = 10 + index * 3;
        var mapId = menu.maps().get(index);
        if (slot == column + 9) {
          visit(player, mapId)
              .ifPresentOrElse(refusal -> Texts.error(player, refusal), player::closeInventory);
        } else if (slot == column + 18) {
          runner.vote(player, mapId).ifPresent(refusal -> Texts.error(player, refusal));
          open(player);
        }
      }
    }
  }

  Optional<String> visit(Player player, String mapId) {
    if (!enabled()) return Optional.of("Candidate visits are not open yet.");
    if (runner.memberOf(player.getUniqueId()).isEmpty() || !player.isOnline())
      return Optional.of("Join the match before visiting.");
    var ballot =
        runner.match().ballot().filter(vote -> !vote.closed() && vote.candidate(mapId).isPresent());
    if (ballot.isEmpty()) return Optional.of("That map is not available to visit on this ballot.");
    if (!rotation.visitable(mapId))
      return Optional.of("That candidate's terrain is still preparing.");
    var map = rotation.byId(mapId).orElseThrow();
    candidateVisitors.put(player.getUniqueId(), mapId);
    player.setGameMode(GameMode.ADVENTURE);
    player.setAllowFlight(true);
    runner.move(player, Places.location(context.mapWorld(), map.definition().spectatorPoint()));
    player.setFlying(true);
    player.setFallDistance(0);
    Texts.info(
        player,
        "Visiting "
            + map.definition().name()
            + ". Fly freely; use /rwf maps to vote, switch or return.");
    return Optional.empty();
  }

  void returnToLobby(Player player) {
    if (candidateVisitors.remove(player.getUniqueId()) == null) return;
    player.setFlying(false);
    player.setAllowFlight(false);
    player.setGameMode(GameMode.SURVIVAL);
    player.setFallDistance(0);
    runner.move(player, runner.lobby());
  }

  private void evacuateVisitors() {
    for (var id : List.copyOf(candidateVisitors.keySet())) {
      var player = context.server().getPlayer(id);
      if (player != null) returnToLobby(player);
      else candidateVisitors.remove(id);
    }
  }

  void tick() {
    for (var entry : List.copyOf(candidateVisitors.entrySet())) {
      var player = context.server().getPlayer(entry.getKey());
      if (player == null || runner.memberOf(entry.getKey()).isEmpty()) {
        candidateVisitors.remove(entry.getKey());
        continue;
      }
      var map = rotation.byId(entry.getValue()).orElseThrow();
      if (!rotation.visitable(map.id())) returnToLobby(player);
      else if (!map.containsVisit(Places.at(player))) {
        runner.move(player, Places.location(context.mapWorld(), map.definition().spectatorPoint()));
        player.setFallDistance(0);
      }
    }
  }
}
