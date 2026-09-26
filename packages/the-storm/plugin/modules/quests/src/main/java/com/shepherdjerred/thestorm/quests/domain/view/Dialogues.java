package com.shepherdjerred.thestorm.quests.domain.view;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig.Labels;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Availability;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.state.ActiveQuest.Phase;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue.Choice;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue.Node;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue.Option;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * What an NPC says about quests to one player: hand-ins first, then choices, then offers. One
 * matter goes straight to its screen; several get a menu. Everything stays inside what Bedrock's
 * simple form shows: a body and at most six buttons.
 */
public final class Dialogues {

  /** The most quests an NPC lists at once. */
  public static final int MAX_ENTRIES = 5;

  private static final int MAX_BUTTON = 32;
  private static final int MAX_TITLE = 48;
  private static final String MENU = "menu";

  private Dialogues() {}

  private enum Kind {
    HAND_IN,
    CHOOSE,
    OFFER
  }

  private record Entry(Kind kind, Quest quest) {}

  /**
   * Who the player is talking to.
   *
   * @param id the NPC id
   * @param name its display name, the dialog title
   */
  public record Npc(String id, String name) {}

  /** What building one dialogue needs. */
  private record Build(
      Map<String, Node> nodes, PlayerQuests state, Context context, Labels labels, boolean menu) {}

  /** The quest dialogue {@code npc} has for the player, if any. */
  public static Optional<QuestDialogue> forNpc(
      PlayerQuests state, Npc npc, Context context, Labels labels) {
    var entries = entries(state, npc.id(), context);
    if (entries.isEmpty()) {
      return Optional.empty();
    }
    var nodes = new HashMap<String, Node>();
    var menu = entries.size() > 1;
    var build = new Build(nodes, state, context, labels, menu);
    for (var entry : entries) {
      add(build, entry);
    }
    String start;
    if (menu) {
      var options = new ArrayList<Option>();
      for (var entry : entries) {
        options.add(new Option(button(entry.quest().name()), new Choice.Goto(nodeOf(entry))));
      }
      options.add(new Option(labels.goodbye(), new Choice.Close()));
      nodes.put(MENU, new Node(labels.menu(), options));
      start = MENU;
    } else {
      start = nodeOf(entries.getFirst());
    }
    return Optional.of(new QuestDialogue(clip(npc.name(), MAX_TITLE), start, nodes));
  }

  /**
   * The matters {@code npc} has with the player, most urgent first, at most {@link #MAX_ENTRIES}.
   */
  private static List<Entry> entries(PlayerQuests state, String npc, Context context) {
    var entries = new ArrayList<Entry>();
    for (var active : state.active().values()) {
      var quest = context.catalog().require(active.quest());
      var stage = QuestEngine.stageOf(context.catalog(), active);
      if (active.phase() == Phase.IN_PROGRESS && handsInAt(stage, npc)) {
        entries.add(new Entry(Kind.HAND_IN, quest));
      } else if (active.phase() == Phase.CHOOSING && quest.giver().equals(npc)) {
        entries.add(new Entry(Kind.CHOOSE, quest));
      }
    }
    context.catalog().all().stream()
        .filter(quest -> quest.giver().equals(npc))
        .filter(quest -> QuestEngine.availability(state, quest, context) == Availability.OFFERABLE)
        .sorted(comparing(Quest::category).thenComparing(Quest::id))
        .forEach(quest -> entries.add(new Entry(Kind.OFFER, quest)));
    return entries.size() > MAX_ENTRIES ? entries.subList(0, MAX_ENTRIES) : entries;
  }

  /** Whether the stage has something to hand in or report at {@code npc}. */
  public static boolean handsInAt(Stage stage, String npc) {
    return stage.objectives().stream()
        .anyMatch(
            objective ->
                (objective instanceof Objective.Talk talk && talk.npc().equals(npc))
                    || (objective instanceof Objective.Deliver deliver
                        && deliver.npc().equals(npc)));
  }

  private static void add(Build build, Entry entry) {
    var nodes = build.nodes();
    var state = build.state();
    var context = build.context();
    var labels = build.labels();
    var menu = build.menu();
    var quest = entry.quest();
    switch (entry.kind()) {
      case HAND_IN -> {
        var stage = stageOf(state, quest, context);
        var options = new ArrayList<Option>();
        options.add(new Option(labels.handIn(), new Choice.HandIn(quest.id())));
        closing(options, labels, menu);
        nodes.put(nodeOf(entry), new Node(stage.waiting().orElseGet(stage::journal), options));
      }
      case CHOOSE -> {
        var stage = stageOf(state, quest, context);
        var options = new ArrayList<Option>();
        if (stage.next() instanceof Stage.Next.Choice(var choices)) {
          for (var index = 0; index < choices.size(); index++) {
            options.add(
                new Option(choices.get(index).label(), new Choice.Choose(quest.id(), index)));
          }
        }
        options.add(new Option(labels.goodbye(), new Choice.Close()));
        nodes.put(nodeOf(entry), new Node(stage.waiting().orElseGet(stage::journal), options));
      }
      case OFFER -> offer(nodes, entry, labels, menu);
    }
  }

  private static void offer(Map<String, Node> nodes, Entry entry, Labels labels, boolean menu) {
    var quest = entry.quest();
    var offerNode = nodeOf(entry);
    var options = new ArrayList<Option>();
    options.add(new Option(labels.accept(), new Choice.Accept(quest.id())));
    var questions = quest.text().questions();
    for (var index = 0; index < questions.size(); index++) {
      var ask = "ask-" + quest.id() + "-" + index;
      options.add(new Option(questions.get(index).label(), new Choice.Goto(ask)));
      nodes.put(
          ask,
          new Node(
              questions.get(index).answer(),
              List.of(new Option(labels.back(), new Choice.Goto(offerNode)))));
    }
    var decline = "decline-" + quest.id();
    options.add(new Option(labels.decline(), new Choice.Goto(decline)));
    if (menu) {
      options.add(new Option(labels.back(), new Choice.Goto(MENU)));
    }
    nodes.put(offerNode, new Node(quest.text().offer(), options));
    nodes.put(
        decline,
        new Node(
            quest.text().decline(), List.of(new Option(labels.goodbye(), new Choice.Close()))));
  }

  private static void closing(List<Option> options, Labels labels, boolean menu) {
    if (menu) {
      options.add(new Option(labels.back(), new Choice.Goto(MENU)));
    }
    options.add(new Option(labels.goodbye(), new Choice.Close()));
  }

  private static Stage stageOf(PlayerQuests state, Quest quest, Context context) {
    return QuestEngine.stageOf(context.catalog(), state.active(quest.id()).orElseThrow());
  }

  private static String nodeOf(Entry entry) {
    return switch (entry.kind()) {
      case HAND_IN -> "hand-" + entry.quest().id();
      case CHOOSE -> "choose-" + entry.quest().id();
      case OFFER -> "offer-" + entry.quest().id();
    };
  }

  private static String button(String name) {
    return clip(name, MAX_BUTTON);
  }

  /** {@code text}, cut to {@code max} characters with an ellipsis if longer. */
  public static String clip(String text, int max) {
    return text.length() <= max ? text : text.substring(0, max - 1) + "…";
  }
}
