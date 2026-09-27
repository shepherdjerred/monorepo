package com.shepherdjerred.thestorm.quests.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.engine.Calendar;
import com.shepherdjerred.thestorm.quests.domain.engine.Catalog;
import com.shepherdjerred.thestorm.quests.domain.engine.Outcome;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Refusal;
import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.model.Condition;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import com.shepherdjerred.thestorm.quests.domain.sim.ScriptedFacts;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Builders for quests, stages and contexts in tests. */
public final class Fixtures {

  public static final UUID PLAYER = new UUID(0, 7);
  public static final Calendar CALENDAR =
      new Calendar(ZoneId.of("America/Los_Angeles"), DayOfWeek.MONDAY);

  /** Noon on Wednesday 2026-09-23 in Los Angeles. */
  public static final Instant NOW = Instant.parse("2026-09-23T19:00:00Z");

  private Fixtures() {}

  public static PlayerQuests empty() {
    return PlayerQuests.empty(PLAYER);
  }

  public static Context context(ScriptedFacts facts, Instant now, Quest... quests) {
    return new Context(Catalog.of(List.of(quests)), facts, now, CALENDAR);
  }

  public static Context context(ScriptedFacts facts, Quest... quests) {
    return context(facts, NOW, quests);
  }

  public static Outcome ok(Result<Outcome, Refusal> result) {
    return switch (result) {
      case Result.Ok<Outcome, Refusal>(var outcome) -> outcome;
      case Result.Err<Outcome, Refusal>(var refusal) ->
          throw new AssertionError("refused: " + refusal);
    };
  }

  public static Refusal refused(Result<Outcome, Refusal> result) {
    return switch (result) {
      case Result.Ok<Outcome, Refusal>(var outcome) ->
          throw new AssertionError("expected a refusal, got " + outcome);
      case Result.Err<Outcome, Refusal>(var refusal) -> refusal;
    };
  }

  /** Accepts {@code quest} and returns the state. */
  public static PlayerQuests accepted(PlayerQuests state, String quest, Context context) {
    return ok(QuestEngine.accept(state, quest, context)).state();
  }

  public static Objective talk(String npc) {
    return new Objective.Talk(npc, Optional.empty());
  }

  public static Stage.Branch always(String target) {
    return new Stage.Branch(target, List.of());
  }

  public static Stage.Branch when(String target, Condition... conditions) {
    return new Stage.Branch(target, List.of(conditions));
  }

  /** A quest builder. */
  public static QuestBuilder quest(String id) {
    return new QuestBuilder(id);
  }

  /** A stage builder. */
  public static StageBuilder stage(String id) {
    return new StageBuilder(id);
  }

  /** Builds quests with defaults: given by {@code giver}, repeat once, one minute. */
  public static final class QuestBuilder {
    private final String id;
    private String giver = "giver";
    private Quest.Category category = Quest.Category.SIDE;
    private Quest.Repeat repeat = Quest.Repeat.ONCE;
    private final List<Condition> requirements = new ArrayList<>();
    private final Map<String, Stage> stages = new LinkedHashMap<>();
    private final List<Action> onAccept = new ArrayList<>();
    private final List<Action> rewards = new ArrayList<>();
    private String start = "";
    private int minutes = 10;

    QuestBuilder(String id) {
      this.id = id;
    }

    public QuestBuilder giver(String npc) {
      giver = npc;
      return this;
    }

    public QuestBuilder category(Quest.Category value) {
      category = value;
      return this;
    }

    public QuestBuilder repeat(Quest.Repeat value) {
      repeat = value;
      return this;
    }

    public QuestBuilder minutes(int value) {
      minutes = value;
      return this;
    }

    public QuestBuilder requires(Condition condition) {
      requirements.add(condition);
      return this;
    }

    public QuestBuilder onAccept(Action action) {
      onAccept.add(action);
      return this;
    }

    public QuestBuilder reward(Action action) {
      rewards.add(action);
      return this;
    }

    public QuestBuilder stage(StageBuilder stage) {
      var built = stage.build();
      if (start.isEmpty()) {
        start = built.id();
      }
      stages.put(built.id(), built);
      return this;
    }

    public QuestBuilder start(String stage) {
      start = stage;
      return this;
    }

    public Quest build() {
      return new Quest(
          id,
          "Quest " + id,
          giver,
          category,
          repeat,
          minutes,
          requirements,
          new Quest.QuestText(
              "offer " + id, "accept " + id, "decline " + id, "finish " + id, "summary", List.of()),
          start,
          stages,
          onAccept,
          rewards);
    }
  }

  /** Builds stages; by default they complete the quest. */
  public static final class StageBuilder {
    private final String id;
    private final List<Objective> objectives = new ArrayList<>();
    private final List<Action> onComplete = new ArrayList<>();
    private Stage.Next next = new Stage.Next.Guarded(List.of(always(Stage.COMPLETE)));
    private Optional<Stage.TimeLimit> limit = Optional.empty();
    private Optional<String> complete = Optional.empty();

    StageBuilder(String id) {
      this.id = id;
    }

    public StageBuilder objective(Objective objective) {
      objectives.add(objective);
      return this;
    }

    public StageBuilder onComplete(Action action) {
      onComplete.add(action);
      return this;
    }

    public StageBuilder then(String target) {
      next = new Stage.Next.Guarded(List.of(always(target)));
      return this;
    }

    public StageBuilder branches(Stage.Branch... branches) {
      next = new Stage.Next.Guarded(List.of(branches));
      return this;
    }

    public StageBuilder choice(Stage.Option... options) {
      next = new Stage.Next.Choice(List.of(options));
      return this;
    }

    public StageBuilder limit(Stage.TimeLimit value) {
      limit = Optional.of(value);
      return this;
    }

    public StageBuilder says(String text) {
      complete = Optional.of(text);
      return this;
    }

    public Stage build() {
      return new Stage(
          id,
          "journal " + id,
          Optional.of("waiting " + id),
          complete,
          objectives,
          onComplete,
          next,
          limit);
    }
  }
}
