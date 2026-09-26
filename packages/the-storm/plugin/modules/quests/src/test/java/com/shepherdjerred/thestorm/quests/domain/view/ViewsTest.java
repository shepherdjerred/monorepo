package com.shepherdjerred.thestorm.quests.domain.view;

import static com.shepherdjerred.thestorm.quests.domain.Fixtures.accepted;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.context;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.empty;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.quest;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.stage;
import static com.shepherdjerred.thestorm.quests.domain.Fixtures.talk;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.quests.app.DialogueBridge;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig.Labels;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEvent;
import com.shepherdjerred.thestorm.quests.domain.model.Action.NpcMark;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue.Choice;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.Test;

/** Quest dialogue, markers, the journal and the sidebar. */
final class ViewsTest {

  static final Labels LABELS =
      new Labels("Accept", "Not now", "Hand over", "Back", "Goodbye", "What can I do for you?");
  static final Describe.Lookup LOOKUP =
      new Describe.Lookup(
          npc -> npc.substring(0, 1).toUpperCase(java.util.Locale.ROOT) + npc.substring(1),
          UnaryOperator.identity());
  static final ItemMatch IRON = ItemMatch.of("IRON_INGOT");

  private final ScriptedFacts facts = new ScriptedFacts();

  private static Quest deliverQuest(String id, String giver) {
    return quest(id)
        .giver(giver)
        .stage(stage("s").objective(new Objective.Deliver(giver, IRON, 4, Optional.empty())))
        .build();
  }

  // ---- dialogue ----------------------------------------------------------------------------

  @Test
  void aSingleOfferGoesStraightToItsScreen() {
    var quest = quest("q").giver("thomas").stage(stage("s").objective(talk("thomas"))).build();
    var dialogue =
        Dialogues.forNpc(
                empty(), new Dialogues.Npc("thomas", "Thomas"), context(facts, quest), LABELS)
            .orElseThrow();
    assertThat(dialogue.title()).isEqualTo("Thomas");
    assertThat(dialogue.start()).isEqualTo("offer-q");
    var offer = dialogue.node("offer-q");
    assertThat(offer.text()).isEqualTo("offer q");
    assertThat(offer.options())
        .extracting(QuestDialogue.Option::label)
        .containsExactly("Accept", "Not now");
    assertThat(offer.options().getFirst().choice()).isEqualTo(new Choice.Accept("q"));
    assertThat(dialogue.nodes()).containsKey("decline-q");
    assertThat(DialogueBridge.graph("thomas", dialogue).problems()).isEmpty();
  }

  @Test
  void questionsGetTheirOwnScreens() {
    var base = quest("q").giver("thomas").stage(stage("s").objective(talk("thomas"))).build();
    var quest =
        new Quest(
            base.id(),
            base.name(),
            base.giver(),
            base.category(),
            base.repeat(),
            base.estimatedMinutes(),
            base.requirements(),
            new Quest.QuestText(
                "offer",
                "accept",
                "decline",
                "finish",
                "summary",
                List.of(new Quest.Question("Why?", "Because."))),
            base.start(),
            base.stages(),
            base.onAccept(),
            base.rewards());
    var dialogue =
        Dialogues.forNpc(
                empty(), new Dialogues.Npc("thomas", "Thomas"), context(facts, quest), LABELS)
            .orElseThrow();
    var ask = dialogue.node("ask-q-0");
    assertThat(ask.text()).isEqualTo("Because.");
    assertThat(ask.options().getFirst().choice()).isEqualTo(new Choice.Goto("offer-q"));
    assertThat(DialogueBridge.graph("thomas", dialogue).problems()).isEmpty();
  }

  @Test
  void anNpcWithNothingForThePlayerSaysNothing() {
    var quest = deliverQuest("q", "thomas");
    assertThat(
            Dialogues.forNpc(
                empty(), new Dialogues.Npc("nat", "Nat"), context(facts, quest), LABELS))
        .isEmpty();
    var done =
        empty()
            .withCompletion(
                "q",
                new com.shepherdjerred.thestorm.quests.domain.state.Completion(
                    1, java.time.Instant.EPOCH));
    assertThat(
            Dialogues.forNpc(
                done, new Dialogues.Npc("thomas", "Thomas"), context(facts, quest), LABELS))
        .isEmpty();
  }

  @Test
  void severalMattersGetAMenuWithHandInsFirst() {
    var active = deliverQuest("active", "thomas");
    var offered =
        quest("offered").giver("thomas").stage(stage("s").objective(talk("thomas"))).build();
    var context = context(facts, active, offered);
    var state = accepted(empty(), "active", context);
    var dialogue =
        Dialogues.forNpc(state, new Dialogues.Npc("thomas", "Thomas"), context, LABELS)
            .orElseThrow();
    assertThat(dialogue.start()).isEqualTo("menu");
    var menu = dialogue.node("menu");
    assertThat(menu.text()).isEqualTo("What can I do for you?");
    assertThat(menu.options())
        .extracting(QuestDialogue.Option::choice)
        .containsExactly(
            new Choice.Goto("hand-active"), new Choice.Goto("offer-offered"), new Choice.Close());
    var hand = dialogue.node("hand-active");
    assertThat(hand.text()).isEqualTo("waiting s");
    assertThat(hand.options())
        .extracting(QuestDialogue.Option::choice)
        .containsExactly(new Choice.HandIn("active"), new Choice.Goto("menu"), new Choice.Close());
    assertThat(DialogueBridge.graph("thomas", dialogue).problems()).isEmpty();
  }

  @Test
  void aChoiceIsMadeAtTheGiver() {
    var quest =
        quest("pick")
            .giver("captain")
            .stage(
                stage("s")
                    .objective(new Objective.Kill("ZOMBIE", 1, Optional.empty()))
                    .choice(
                        new Stage.Option("Expose", "complete"), new Stage.Option("Bribe", "fail")))
            .build();
    var context = context(facts, quest);
    var state =
        QuestEngine.handle(
                accepted(empty(), "pick", context), new QuestEvent.Killed("ZOMBIE"), context)
            .state();
    var dialogue =
        Dialogues.forNpc(state, new Dialogues.Npc("captain", "Captain"), context, LABELS)
            .orElseThrow();
    var node = dialogue.node(dialogue.start());
    assertThat(node.options())
        .extracting(QuestDialogue.Option::choice)
        .containsExactly(
            new Choice.Choose("pick", 0), new Choice.Choose("pick", 1), new Choice.Close());
    var graph = DialogueBridge.graph("captain", dialogue);
    assertThat(graph.problems()).isEmpty();
    assertThat(DialogueBridge.choose("pick", 1)).isEqualTo("quests.choose.pick.1");
    assertThat(DialogueBridge.accept("pick")).isEqualTo("quests.accept.pick");
    assertThat(DialogueBridge.turnIn("pick")).isEqualTo("quests.turnin.pick");
  }

  @Test
  void atMostFiveMattersAreListedWithLongNamesClipped() {
    var quests =
        java.util.stream.IntStream.range(0, 7)
            .mapToObj(
                index ->
                    new Quest(
                        "q" + index,
                        "An extraordinarily long quest name number " + index,
                        "thomas",
                        Quest.Category.SIDE,
                        Quest.Repeat.ONCE,
                        5,
                        List.of(),
                        new Quest.QuestText("o", "a", "d", "f", "s", List.of()),
                        "s",
                        Map.of("s", stage("s").objective(talk("thomas")).build()),
                        List.of(),
                        List.of()))
            .toArray(Quest[]::new);
    var dialogue =
        Dialogues.forNpc(
                empty(), new Dialogues.Npc("thomas", "Thomas"), context(facts, quests), LABELS)
            .orElseThrow();
    var menu = dialogue.node("menu");
    assertThat(menu.options()).hasSize(Dialogues.MAX_ENTRIES + 1);
    assertThat(menu.options().getFirst().label()).hasSize(32).endsWith("…");
    assertThat(DialogueBridge.graph("thomas", dialogue).problems()).isEmpty();
  }

  // ---- markers -----------------------------------------------------------------------------

  @Test
  void markersShowOffersHandInsAndPins() {
    var offered = quest("offered").giver("nat").stage(stage("s").objective(talk("nat"))).build();
    var hidden =
        quest("hidden")
            .giver("stanley")
            .category(Quest.Category.HIDDEN)
            .stage(stage("s").objective(talk("stanley")))
            .build();
    var active = deliverQuest("active", "thomas");
    var context = context(facts, offered, hidden, active);
    var state = accepted(empty(), "active", context).withMark("cade", NpcMark.AVAILABLE);
    var npcs = Markers.npcs(state, context);
    assertThat(npcs).containsExactlyInAnyOrder("nat", "stanley", "thomas", "cade");
    var marks = Markers.compute(state, context, npcs);
    assertThat(marks)
        .containsEntry("nat", NpcMark.AVAILABLE)
        .containsEntry("stanley", NpcMark.NONE)
        .containsEntry("thomas", NpcMark.NONE)
        .containsEntry("cade", NpcMark.AVAILABLE);
    facts.give(IRON, 4);
    assertThat(Markers.compute(state, context, Set.of("thomas")))
        .containsEntry("thomas", NpcMark.TURN_IN);
  }

  @Test
  void aReportMarkerAppearsOnceTheRestIsDone() {
    var quest =
        quest("report")
            .giver("captain")
            .stage(
                stage("s")
                    .objective(new Objective.Kill("ZOMBIE", 1, Optional.empty()))
                    .objective(talk("captain")))
            .build();
    var context = context(facts, quest);
    var state = accepted(empty(), "report", context);
    assertThat(Markers.compute(state, context, Set.of("captain")))
        .containsEntry("captain", NpcMark.NONE);
    var killed = QuestEngine.handle(state, new QuestEvent.Killed("ZOMBIE"), context).state();
    assertThat(Markers.compute(killed, context, Set.of("captain")))
        .containsEntry("captain", NpcMark.TURN_IN);
  }

  // ---- journal and sidebar -----------------------------------------------------------------

  @Test
  void theJournalListsActiveQuestsProgressAndStanding() {
    var quest =
        quest("smith")
            .giver("thomas")
            .stage(
                stage("s")
                    .objective(new Objective.Deliver("thomas", IRON, 32, Optional.empty()))
                    .objective(new Objective.Kill("ZOMBIE", 1, Optional.empty())))
            .build();
    var context = context(facts, quest);
    var state =
        QuestEngine.handle(
                accepted(empty(), "smith", context), new QuestEvent.Killed("ZOMBIE"), context)
            .state()
            .withReputation("town", 16)
            .withPoints(3);
    var factions =
        Map.of(
            "town",
            new Faction(
                "town",
                "Spawn Town",
                List.of(new Faction.Rank("Neighbour", 5), new Faction.Rank("Friend", 15))));
    var view = Journal.journal(state, context.catalog(), LOOKUP, factions);
    assertThat(view.active()).containsExactly("smith");
    assertThat(view.body())
        .contains("» Quest smith")
        .contains("journal s")
        .contains("• Bring 32 Iron Ingot to Thomas 0/32")
        .contains("✔ Kill 1 Zombie")
        .contains("Quest points: 3")
        .contains("Spawn Town: 16 (Friend)");
    var sidebar = Journal.sidebar(state, context.catalog(), LOOKUP, 8).orElseThrow();
    assertThat(sidebar.title()).isEqualTo("Quest smith");
    assertThat(sidebar.lines()).hasSize(2);
    assertThat(Journal.sidebar(state.withTracked(Optional.empty()), context.catalog(), LOOKUP, 8))
        .isEmpty();
    assertThat(Journal.sidebar(state, context.catalog(), LOOKUP, 1).orElseThrow().lines())
        .hasSize(1);
  }

  @Test
  void anEmptyJournalPointsAtQuestGivers() {
    var view = Journal.journal(empty(), context(facts).catalog(), LOOKUP, Map.of());
    assertThat(view.body()).contains("You have no quests");
    assertThat(view.active()).isEmpty();
  }

  @Test
  void describeCoversEveryObjective() {
    var lines =
        List.of(
            new Objective.Talk("nat", Optional.empty()),
            new Objective.Hold(IRON, 2, Optional.empty()),
            new Objective.Collect(IRON, 2, Optional.empty()),
            new Objective.Craft(IRON, 2, Optional.empty()),
            new Objective.Fish(Optional.empty(), 2, Optional.empty()),
            new Objective.Fish(Optional.of(ItemMatch.of("COD")), 2, Optional.empty()),
            new Objective.Mine("STONE", 2, Optional.empty()),
            new Objective.Place("TORCH", 2, Optional.empty()),
            new Objective.Reach("mines", Optional.empty()),
            new Objective.Level("mechanic", 2, Optional.empty()),
            new Objective.Custom("arena-wave", 2, Optional.empty()),
            new Objective.Talk("nat", Optional.of("A secret")));
    assertThat(lines.stream().map(objective -> Describe.objective(objective, LOOKUP)).toList())
        .containsExactly(
            "Talk to Nat",
            "Carry 2 Iron Ingot",
            "Collect 2 Iron Ingot",
            "Craft 2 Iron Ingot",
            "Catch 2 fish",
            "Catch 2 Cod",
            "Mine 2 Stone",
            "Place 2 Torch",
            "Reach mines",
            "Reach Mechanic 2",
            "Arena Wave x2",
            "A secret");
    assertThat(
            Describe.item(
                new ItemMatch(
                    "DIAMOND_SWORD", Optional.empty(), Map.of("sharpness", 5), Optional.empty())))
        .isEqualTo("Diamond Sword (Sharpness 5)");
    assertThat(
            Describe.item(
                new ItemMatch("POTION", Optional.empty(), Map.of(), Optional.of("strong_healing"))))
        .isEqualTo("Potion (Strong Healing)");
    assertThat(
            Describe.item(
                new ItemMatch("PAPER", Optional.of("Crime Report"), Map.of(), Optional.empty())))
        .isEqualTo("Crime Report");
    assertThat(Describe.progress(3, 4)).isEqualTo("3/4");
    assertThat(Describe.progress(4, 4)).isEqualTo("done");
    assertThat(Names.pretty("ZOMBIFIED_PIGLIN")).isEqualTo("Zombified Piglin");
  }
}
