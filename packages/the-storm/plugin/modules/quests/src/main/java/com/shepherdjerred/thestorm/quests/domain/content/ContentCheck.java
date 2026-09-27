package com.shepherdjerred.thestorm.quests.domain.content;

import com.shepherdjerred.thestorm.quests.domain.board.BoardQuests;
import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig.Budget;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.view.Names;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * The content linter. Run at enable and over the shipped content in a Gradle test. It checks that
 * every reference exists (NPCs, items, blocks, entities, regions, worlds, tracks, quests, factions,
 * variables, hooks), every stage is reachable and can reach completion, no stage loop spins without
 * objectives, no quest requires itself through other quests, variables that are read are also set
 * somewhere, text fits the dialog and sidebar limits, and rewards stay within the crystal budget.
 */
public final class ContentCheck {

  /** The longest quest name (a dialog title). */
  public static final int MAX_NAME = 48;

  /** The longest spoken text (a dialog body). */
  public static final int MAX_TEXT = 600;

  /** The longest button label. */
  public static final int MAX_LABEL = 32;

  /** The longest journal line and objective text. */
  public static final int MAX_JOURNAL = 200;

  /** The longest custom objective text (a sidebar line). */
  public static final int MAX_OBJECTIVE = 40;

  /** The most questions or choices. */
  public static final int MAX_QUESTIONS = 3;

  /** The most options in a choice. */
  public static final int MAX_CHOICES = 5;

  /**
   * What content is checked against.
   *
   * @param registry what exists on the server
   * @param budget the crystal budget
   * @param boardNpc the NPC board quests belong to
   * @param allowedWorld the dimension key of the main world
   */
  public record Rules(
      ContentRegistry registry, Budget budget, String boardNpc, String allowedWorld) {}

  private final QuestContent content;
  private final Rules rules;
  private final List<ContentProblem> problems = new ArrayList<>();
  private final Set<String> variablesSet = new HashSet<>();
  private final Map<String, String> variablesRead = new TreeMap<>();
  private String source = "";
  private String path = "";

  private ContentCheck(QuestContent content, Rules rules) {
    this.content = content;
    this.rules = rules;
  }

  /** Every problem with {@code content}; empty when it is valid. */
  public static List<ContentProblem> problems(QuestContent content, Rules rules) {
    var check = new ContentCheck(content, rules);
    check.run();
    return List.copyOf(check.problems);
  }

  private void run() {
    new TreeMap<>(content.regions())
        .forEach(
            (id, region) -> {
              at("quests", "regions." + id);
              if (!rules.registry().worlds().contains(region.world())) {
                problem("world " + region.world() + " is not loaded");
              }
              if (!rules.allowedWorld().equals(region.world())) {
                problem("world " + region.world() + " is outside the main world");
              }
              text("name", region.name(), MAX_NAME);
            });
    if (!rules.registry().npcs().contains(rules.boardNpc())) {
      at("quests.yml", "board.npc");
      problem("board NPC " + rules.boardNpc() + " does not exist");
    }
    new TreeMap<>(content.quests()).values().forEach(this::quest);
    new TreeMap<>(content.templates()).values().forEach(this::template);
    requirementCycles();
    variablesRead.forEach(
        (variable, where) -> {
          if (!variablesSet.contains(variable)) {
            problems.add(
                new ContentProblem(
                    where, "", "variable " + variable + " is read but no action ever sets it"));
          }
        });
  }

  // ---- quests --------------------------------------------------------------------------------

  private void quest(Quest quest) {
    at(content.source(quest.id()), "quests." + quest.id());
    text("name", quest.name(), MAX_NAME);
    npc(quest.giver());
    if ((quest.category() == Quest.Category.DAILY || quest.category() == Quest.Category.WEEKLY)
        && quest.repeat() == Quest.Repeat.ONCE) {
      problem("daily and weekly quests must repeat");
    }
    questText(quest.text());
    quest.requirements().forEach(this::condition);
    quest.onAccept().forEach(action -> action(quest, action));
    quest.rewards().forEach(action -> action(quest, action));
    Graph.problems(quest).forEach(this::problem);
    var limit = rules.budget().limit(quest.estimatedMinutes());
    var richest = Graph.richestPath(quest);
    if (richest > limit) {
      problem(
          "pays up to "
              + richest
              + " crystals, over the budget of "
              + limit
              + " for "
              + quest.estimatedMinutes()
              + " minutes");
    }
    var questPath = path;
    for (var stage : new TreeMap<>(quest.stages()).values()) {
      path = questPath + ".stages." + stage.id();
      stage(quest, stage);
    }
    path = questPath;
  }

  private void questText(Quest.QuestText text) {
    text("text.offer", text.offer(), MAX_TEXT);
    text("text.accept", text.accept(), MAX_TEXT);
    text("text.decline", text.decline(), MAX_TEXT);
    text("text.finish", text.finish(), MAX_TEXT);
    text("text.summary", text.summary(), MAX_JOURNAL);
    if (text.questions().size() > MAX_QUESTIONS) {
      problem("at most " + MAX_QUESTIONS + " questions fit beside Accept and Decline");
    }
    for (var question : text.questions()) {
      text("text.questions.label", question.label(), MAX_LABEL);
      text("text.questions.answer", question.answer(), MAX_TEXT);
    }
  }

  private void stage(Quest quest, Stage stage) {
    text("journal", stage.journal(), MAX_JOURNAL);
    stage.waiting().ifPresent(value -> text("waiting", value, MAX_TEXT));
    stage.complete().ifPresent(value -> text("complete", value, MAX_TEXT));
    stage.objectives().forEach(this::objective);
    stage.onComplete().forEach(action -> action(quest, action));
    switch (stage.next()) {
      case Stage.Next.Guarded(var branches) ->
          branches.forEach(branch -> branch.when().forEach(this::condition));
      case Stage.Next.Choice(var options) -> {
        if (options.size() > MAX_CHOICES) {
          problem("a choice has at most " + MAX_CHOICES + " options");
        }
        options.forEach(option -> text("next.label", option.label(), MAX_LABEL));
      }
    }
  }

  private void objective(Objective objective) {
    objective.label().ifPresent(label -> text("objective text", label, MAX_OBJECTIVE));
    switch (objective) {
      case Objective.Talk(var npc, _) -> npc(npc);
      case Objective.Deliver(var npc, var item, _, _) -> {
        npc(npc);
        item(item);
      }
      case Objective.Hold(var item, _, _) -> item(item);
      case Objective.Collect(var item, _, _) -> item(item);
      case Objective.Craft(var item, _, _) -> item(item);
      case Objective.Fish(var item, _, _) -> item.ifPresent(this::item);
      case Objective.Mine(var block, _, _) -> block(block);
      case Objective.Place(var block, _, _) -> block(block);
      case Objective.Kill(var entity, _, _) -> killable(entity);
      case Objective.Reach(var region, _) -> region(region);
      case Objective.Level(var track, var level, _) -> track(track, level);
      case Objective.Custom(var hook, _, _) -> hook(hook);
    }
  }

  private void condition(Condition condition) {
    switch (condition) {
      case Condition.HasItem(var item, _) -> item(item);
      case Condition.TrackAtLeast(var track, var level) -> track(track, level);
      case Condition.Completed(var quest) -> quest(quest);
      case Condition.Active(var quest) -> quest(quest);
      case Condition.ReputationAtLeast(var faction, _) -> faction(faction);
      case Condition.InRegion(var region) -> region(region);
      case Condition.HasPermission(var node) -> permission(node);
      case Condition.Compare(var variable, _, _) -> read(variable);
      case Condition.Not(var inner) -> condition(inner);
      case Condition.PointsAtLeast _, Condition.TimeBetween _, Condition.WeatherIs _ -> {
        // Nothing to look up.
      }
    }
  }

  private void action(Quest quest, Action action) {
    switch (action) {
      case Action.Give(var item, _) -> item(item);
      case Action.Take(var item, _) -> item(item);
      case Action.Grant(var node) -> permission(node);
      case Action.Title(var id) -> key("title", id);
      case Action.Spell(var id) -> key("spell", id);
      case Action.SetVariable(var variable, _) -> write(variable);
      case Action.AddVariable(var variable, _) -> write(variable);
      case Action.Reputation(var faction, _) -> faction(faction);
      case Action.StartQuest(var id) -> {
        quest(id);
        if (id.equals(quest.id())) {
          problem("a quest cannot start itself");
        }
      }
      case Action.Message(var text) -> text("message", text, MAX_TEXT);
      case Action.Teleport(var region) -> region(region);
      case Action.Spawn(var entity, _, var region, var name) -> {
        spawnable(entity);
        region(region);
        name.ifPresent(value -> text("spawn name", value, MAX_NAME));
      }
      case Action.Marker(var npc, _) -> npc(npc);
      case Action.Custom(var hook, _) -> hook(hook);
      case Action.Crystals _, Action.Points _ -> {
        // Budgeted per quest.
      }
    }
  }

  // ---- board templates -----------------------------------------------------------------------

  private void template(Template template) {
    at(content.source(template.id()), "templates." + template.id());
    text("name", template.name(), MAX_NAME);
    text("offer", template.offer(), MAX_TEXT - 20);
    text("accept", template.accept(), MAX_TEXT);
    text("decline", template.decline(), MAX_TEXT);
    text("finish", template.finish(), MAX_TEXT);
    for (var target : template.targets()) {
      switch (template.kind()) {
        case KILL -> killable(target.id());
        case DELIVER -> item(ItemMatch.of(target.id()));
      }
      for (var amount : List.of(target.min(), target.max())) {
        var draw = BoardQuests.priced(template, target, amount);
        var minutes = BoardQuests.minutes(target, amount);
        var limit = rules.budget().limit(minutes);
        if (draw.reward() > limit) {
          problem(
              target.id()
                  + " x"
                  + amount
                  + " pays "
                  + draw.reward()
                  + " crystals, over the budget of "
                  + limit
                  + " for "
                  + minutes
                  + " minutes");
        }
        var filled =
            template
                .name()
                .replace("{amount}", Integer.toString(amount))
                .replace("{target}", Names.pretty(target.id()));
        if (filled.length() > MAX_NAME) {
          problem("name \"" + filled + "\" is longer than " + MAX_NAME + " characters");
        }
      }
    }
  }

  // ---- whole-content checks ------------------------------------------------------------------

  private void requirementCycles() {
    var requires = new HashMap<String, List<String>>();
    for (var quest : content.quests().values()) {
      var needed = new ArrayList<String>();
      for (var condition : quest.requirements()) {
        if (condition instanceof Condition.Completed(var other)) {
          needed.add(other);
        }
      }
      requires.put(quest.id(), needed);
    }
    for (var quest : new TreeMap<>(content.quests()).keySet()) {
      if (requiresItself(quest, requires)) {
        at(content.source(quest), "quests." + quest);
        problem("requires completing itself through other quests' requirements");
      }
    }
  }

  private static boolean requiresItself(String quest, Map<String, List<String>> requires) {
    var seen = new HashSet<String>();
    var stack = new ArrayList<>(requires.getOrDefault(quest, List.of()));
    while (!stack.isEmpty()) {
      var next = stack.removeLast();
      if (next.equals(quest)) {
        return true;
      }
      if (seen.add(next)) {
        stack.addAll(requires.getOrDefault(next, List.of()));
      }
    }
    return false;
  }

  // ---- references ----------------------------------------------------------------------------

  private void npc(String id) {
    if (!rules.registry().npcs().contains(id)) {
      problem("NPC " + id + " does not exist");
    }
  }

  private void item(ItemMatch item) {
    if (!rules.registry().items().contains(item.material())) {
      problem(item.material() + " is not an item");
    }
    for (var enchantment : item.enchantments().keySet()) {
      if (!rules.registry().enchantments().contains(enchantment)) {
        problem("enchantment " + enchantment + " does not exist");
      }
    }
    item.potion()
        .filter(potion -> !rules.registry().potions().contains(potion))
        .ifPresent(potion -> problem("potion type " + potion + " does not exist"));
  }

  private void block(String block) {
    if (!rules.registry().blocks().contains(block)) {
      problem(block + " is not a block");
    }
  }

  private void killable(String entity) {
    if ("PLAYER".equals(entity)) {
      problem("killing players is not a quest objective");
    } else if (!rules.registry().entities().contains(entity)) {
      problem(entity + " is not a creature");
    }
  }

  private void spawnable(String entity) {
    if ("PLAYER".equals(entity) || !rules.registry().entities().contains(entity)) {
      problem(entity + " cannot be spawned");
    }
  }

  private void region(String region) {
    if (content.region(region).isEmpty()) {
      problem("region " + region + " does not exist");
    }
  }

  private void track(String track, int level) {
    if (!rules.registry().tracks().contains(track)) {
      problem("track " + track + " does not exist");
    }
    if (level > 5) {
      problem("tracks go up to level 5");
    }
  }

  private void quest(String id) {
    if (!content.quests().containsKey(id)) {
      problem("quest " + id + " does not exist");
    }
  }

  private void faction(String faction) {
    if (content.faction(faction).isEmpty()) {
      problem("faction " + faction + " does not exist");
    }
  }

  private void hook(String hook) {
    if (!content.hooks().containsKey(hook)) {
      problem("hook " + hook + " is not declared under hooks");
    }
  }

  private void read(String variable) {
    declared(variable);
    variablesRead.putIfAbsent(variable, source);
  }

  private void write(String variable) {
    declared(variable);
    variablesSet.add(variable);
  }

  private void declared(String variable) {
    if (!content.variables().containsKey(variable)) {
      problem("variable " + variable + " is not declared under variables");
    }
  }

  private void permission(String node) {
    if (!node.matches("[a-z0-9_.-]+")) {
      problem("permission " + node + " must be lowercase words joined by dots");
    }
  }

  private void key(String kind, String id) {
    if (!ContentCompiler.ID.matcher(id).matches()) {
      problem(kind + " ids are lowercase letters, digits, - and _: " + id);
    }
  }

  private void text(String what, String value, int max) {
    if (value.isBlank() || value.length() > max) {
      problem(what + " must be 1.." + max + " characters (is " + value.length() + ")");
    }
  }

  private void at(String inSource, String inPath) {
    source = inSource;
    path = inPath;
  }

  private void problem(String message) {
    problems.add(new ContentProblem(source, path, message));
  }
}
