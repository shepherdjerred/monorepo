package com.shepherdjerred.thestorm.npcs.app;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.choices;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.option;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.Fixtures;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/** The action and marker registries, the directory and trainer wording. */
final class RegistriesTest {

  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void actionIdsAreNamespacedAndUnique() {
    var actions = new ActionRegistry();
    actions.register("quests.accept", (player, npc) -> {});
    assertThat(actions.ids()).containsExactly("quests.accept");
    assertThat(actions.find("quests.accept")).isPresent();
    assertThat(actions.find("quests.decline")).isEmpty();
    assertThatThrownBy(() -> actions.register("quests.accept", (player, npc) -> {}))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> actions.register("accept", (player, npc) -> {}))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void missingActionsAreListedFromDialogues() {
    var actions = new ActionRegistry();
    actions.register("quests.accept", (player, npc) -> {});
    var graph =
        new DialogueGraph(
            "d",
            "T",
            "a",
            Map.of(
                "a",
                choices(
                    "A",
                    option("1", new OptionEffect.RunAction("quests.accept")),
                    option("2", new OptionEffect.RunAction("shops.open")),
                    option("3", new OptionEffect.RunAction("bank.deposit")))));
    assertThat(actions.missing(List.of(graph))).containsExactly("bank.deposit", "shops.open");
  }

  @Test
  void theDirectoryListsNpcsSorted() {
    var catalog =
        new NpcCatalog(
            new Content(
                Map.of("stan", Fixtures.npc("stan"), "nat", Fixtures.npc("nat")),
                Map.of(),
                Map.of(),
                Map.of()));
    assertThat(catalog.all()).extracting(NpcRef::id).containsExactly("nat", "stan");
    assertThat(catalog.find("nat")).contains(NpcRef.of(Fixtures.npc("nat")));
    assertThat(catalog.find("ghost")).isEmpty();
    assertThat(catalog.find("nat").orElseThrow().roles()).isEqualTo(Set.of("role"));
  }

  @Test
  void markersShowOnlyWhenTheyChange() {
    var catalog =
        new NpcCatalog(
            new Content(Map.of("stan", Fixtures.npc("stan")), Map.of(), Map.of(), Map.of()));
    var displays = new Fakes.Displays();
    var markers = new MarkerService(catalog, displays);
    var alice = server.addPlayer("Alice");
    var bob = server.addPlayer("Bob");
    markers.set(alice, "stan", QuestMarker.AVAILABLE);
    markers.set(alice, "stan", QuestMarker.AVAILABLE);
    markers.set(bob, "stan", QuestMarker.TURN_IN);
    assertThat(displays.updates)
        .containsExactly(
            new Fakes.Displays.Update(alice, "stan", QuestMarker.AVAILABLE),
            new Fakes.Displays.Update(bob, "stan", QuestMarker.TURN_IN));
    assertThat(markers.get(alice, "stan")).isEqualTo(QuestMarker.AVAILABLE);

    displays.updates.clear();
    markers.showNpc("stan", id -> id.equals(alice.getUniqueId()) ? alice : null);
    assertThat(displays.updates)
        .containsExactly(new Fakes.Displays.Update(alice, "stan", QuestMarker.AVAILABLE));

    markers.forget(alice);
    assertThat(markers.get(alice, "stan")).isEqualTo(QuestMarker.NONE);
    assertThatThrownBy(() -> markers.set(alice, "ghost", QuestMarker.AVAILABLE))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void trainerWordingCoversEveryProblem() {
    var now = Instant.parse("2026-09-25T12:00:00Z");
    var wording = new TrainerWording(amount -> amount + " CR", InstantSource.fixed(now));
    var quote = new Quote(Track.GOVERNOR, 2, 500);
    List<PurchaseProblem> problems =
        List.of(
            new PurchaseProblem.AlreadyMaxed(Track.GOVERNOR),
            new PurchaseProblem.NotNextLevel(Track.GOVERNOR, 1, 3),
            new PurchaseProblem.AbovePrimary(Track.GOVERNOR, 3, Track.MECHANIC, 2),
            new PurchaseProblem.CoolingDown(now.plus(Duration.ofMinutes(5))),
            new PurchaseProblem.CannotAfford(500, 20),
            new PurchaseProblem.QuoteChanged(quote, quote),
            new PurchaseProblem.StillLoading(),
            new PurchaseProblem.LoadFailed(),
            new PurchaseProblem.ShuttingDown(),
            new PurchaseProblem.AlreadyBuying(),
            new PurchaseProblem.NotRecorded(quote));
    assertThat(problems.stream().map(wording::explain))
        .containsExactly(
            "You have mastered Governor. There is nothing left to teach you.",
            "Governor levels are learned in order; you are level 1.",
            "Governor can't pass your primary track, Mechanic (level 2). Train Mechanic first.",
            "You trained recently. Come back in 5 minutes.",
            "That costs 500 CR, and you have 20 CR.",
            "The price changed while you decided; here is the new offer.",
            "Your training records are still loading. Try again in a moment.",
            "Your training records could not be loaded. Try again shortly.",
            "The server is restarting. Try again after.",
            "Your last purchase is still going through.",
            "The lesson could not be recorded, so your crystals were refunded.");
  }

  @Test
  void waitsRoundUpToWholeMinutes() {
    assertThat(TrainerWording.wait(Duration.ofSeconds(1))).isEqualTo("1 minute");
    assertThat(TrainerWording.wait(Duration.ofSeconds(-5))).isEqualTo("1 minute");
    assertThat(TrainerWording.wait(Duration.ofMinutes(60))).isEqualTo("1 hour");
    assertThat(TrainerWording.wait(Duration.ofMinutes(61).plusSeconds(1)))
        .isEqualTo("1 hour 2 minutes");
    assertThat(TrainerWording.wait(Duration.ofHours(24))).isEqualTo("24 hours");
    assertThat(TrainerWording.trackName(Track.SPELLCASTER)).isEqualTo("Spellcaster");
  }

  @Test
  void theInteractEventCarriesTheNpcAndCancels() {
    var player = server.addPlayer("Carol");
    var event = new NpcInteractEvent(player, NpcRef.of(Fixtures.npc("stan")));
    assertThat(event.player()).isSameAs(player);
    assertThat(event.npc().id()).isEqualTo("stan");
    assertThat(event.isCancelled()).isFalse();
    event.setCancelled(true);
    assertThat(event.isCancelled()).isTrue();
    assertThat(event.getHandlers()).isSameAs(NpcInteractEvent.getHandlerList());
  }
}
