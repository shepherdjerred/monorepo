package com.shepherdjerred.thestorm.quests.domain.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCompiler.Sourced;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.BranchEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.FactionEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.QuestEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.RankEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.RegionEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.StageEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.TargetEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.TemplateEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.TextEntry;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ContentCompilerTest {

  static final TextEntry TEXT =
      new TextEntry("offer", "accept", "decline", "finish", "summary", List.of());

  static StageEntry stage(List<String> objectives, List<BranchEntry> next) {
    return new StageEntry("journal", "none", "Done!", objectives, List.of(), next, "none");
  }

  static BranchEntry to(String target) {
    return new BranchEntry(target, List.of(), "none");
  }

  static QuestEntry quest(Map<String, StageEntry> stages, String start) {
    return new QuestEntry(
        "Quest",
        "thomas",
        "side",
        "once",
        10,
        List.of(),
        TEXT,
        start,
        stages,
        List.of(),
        List.of("crystals 10"));
  }

  static ContentFile file(Map<String, QuestEntry> quests) {
    return new ContentFile(Map.of(), Map.of(), Map.of(), Map.of(), quests, Map.of());
  }

  private static List<ContentProblem> problems(Sourced... files) {
    return ContentCompiler.compile(List.of(files)).fold(content -> List.of(), found -> found);
  }

  private static QuestContent compiled(Sourced... files) {
    return ContentCompiler.compile(List.of(files))
        .fold(
            content -> content,
            found -> {
              throw new AssertionError(found.toString());
            });
  }

  @Test
  void aFullFileCompiles() {
    var stages = new LinkedHashMap<String, StageEntry>();
    stages.put("hunt", stage(List.of("kill 3 ZOMBIE"), List.of(to("choose"))));
    stages.put(
        "choose",
        stage(
            List.of("talk thomas"),
            List.of(
                new BranchEntry("complete", List.of(), "Keep it"),
                new BranchEntry("fail", List.of(), "Give it"))));
    var file =
        new ContentFile(
            Map.of("town", new FactionEntry("Town", List.of(new RankEntry("Friend", 5)))),
            Map.of("met", "Whether they met"),
            Map.of("mines", new RegionEntry("Mines", "minecraft:overworld", 1, 2, 3, 10)),
            Map.of("wave", "Arena waves"),
            Map.of("q", quest(stages, "hunt")),
            Map.of(
                "bounty",
                new TemplateEntry(
                    "daily",
                    "kill",
                    "Bounty",
                    "offer",
                    "accept",
                    "decline",
                    "finish",
                    10,
                    List.of(new TargetEntry("ZOMBIE", 1, 1, 2, 1, 1)))));
    var content = compiled(new Sourced("quests/a.yml", file));
    var quest = content.catalog().require("q");
    assertThat(quest.category()).isEqualTo(Quest.Category.SIDE);
    assertThat(quest.stage("choose").orElseThrow().next()).isInstanceOf(Stage.Next.Choice.class);
    assertThat(quest.stage("hunt").orElseThrow().complete()).contains("Done!");
    assertThat(quest.stage("hunt").orElseThrow().waiting()).isEmpty();
    assertThat(content.faction("town")).isPresent();
    assertThat(content.regions()).containsKey("mines");
    assertThat(content.variables()).containsKey("met");
    assertThat(content.hooks()).containsKey("wave");
    assertThat(content.template("bounty").orElseThrow().kind()).isEqualTo(Template.Kind.KILL);
    assertThat(content.source("q")).isEqualTo("quests/a.yml");
  }

  @Test
  void idsAreUniqueAcrossFiles() {
    var one = Map.of("q", quest(Map.of("s", stage(List.of(), List.of(to("complete")))), "s"));
    var found = problems(new Sourced("a.yml", file(one)), new Sourced("b.yml", file(one)));
    assertThat(found)
        .singleElement()
        .satisfies(
            problem -> {
              assertThat(problem.source()).isEqualTo("b.yml");
              assertThat(problem.message()).contains("already defined in a.yml");
            });
  }

  @Test
  void badIdsAndReservedStageNamesAreRejected() {
    var badId =
        Map.of("Bad Id", quest(Map.of("s", stage(List.of(), List.of(to("complete")))), "s"));
    assertThat(problems(new Sourced("a.yml", file(badId))))
        .singleElement()
        .asString()
        .contains("ids are");
    var reserved =
        Map.of(
            "q", quest(Map.of("complete", stage(List.of(), List.of(to("complete")))), "complete"));
    assertThat(problems(new Sourced("a.yml", file(reserved)))).asString().contains("reserved");
  }

  @Test
  void everyBadLineIsReportedWithItsPath() {
    var entry =
        new StageEntry(
            "j",
            "none",
            "none",
            List.of("kill many ZOMBIE", "dance"),
            List.of("explode"),
            List.of(new BranchEntry("complete", List.of("sunny"), "none")),
            "soon");
    var quests = Map.of("q", quest(Map.of("s", entry), "s"));
    var found = problems(new Sourced("a.yml", file(quests)));
    assertThat(found)
        .extracting(ContentProblem::path)
        .contains(
            "quests.q.stages.s.objectives[0]",
            "quests.q.stages.s.objectives[1]",
            "quests.q.stages.s.onComplete[0]",
            "quests.q.stages.s.next[0].when[0]",
            "quests.q.stages.s.timeLimit");
  }

  @Test
  void branchesAreAllGuardedOrAllChoices() {
    var mixed =
        stage(List.of(), List.of(to("complete"), new BranchEntry("fail", List.of(), "Give up")));
    assertThat(problems(new Sourced("a.yml", file(Map.of("q", quest(Map.of("s", mixed), "s"))))))
        .asString()
        .contains("either all choices");
    var guardedChoice =
        stage(List.of(), List.of(new BranchEntry("complete", List.of("points 1"), "Go")));
    assertThat(
            problems(
                new Sourced("a.yml", file(Map.of("q", quest(Map.of("s", guardedChoice), "s"))))))
        .asString()
        .contains("choices cannot have conditions");
    var none = stage(List.of(), List.of());
    assertThat(problems(new Sourced("a.yml", file(Map.of("q", quest(Map.of("s", none), "s"))))))
        .asString()
        .contains("at least one branch");
  }

  @Test
  void unknownEnumsAndRecordRulesAreProblems() {
    var entry =
        new QuestEntry(
            "Quest",
            "thomas",
            "epic",
            "hourly",
            0,
            List.of(),
            TEXT,
            "s",
            Map.of("s", stage(List.of(), List.of(to("complete")))),
            List.of(),
            List.of());
    var found = problems(new Sourced("a.yml", file(Map.of("q", entry))));
    assertThat(found)
        .extracting(ContentProblem::path)
        .contains("quests.q.category", "quests.q.repeat");
    var zeroMinutes =
        new QuestEntry(
            "Quest",
            "thomas",
            "side",
            "once",
            0,
            List.of(),
            TEXT,
            "s",
            Map.of("s", stage(List.of(), List.of(to("complete")))),
            List.of(),
            List.of());
    assertThat(problems(new Sourced("a.yml", file(Map.of("q", zeroMinutes)))))
        .asString()
        .contains("at least a minute");
    var badRegion =
        new ContentFile(
            Map.of(),
            Map.of(),
            Map.of("r", new RegionEntry("R", "w", 0, 0, 0, 0)),
            Map.of(),
            Map.of(),
            Map.of());
    assertThat(problems(new Sourced("a.yml", badRegion))).asString().contains("positive radius");
    var blankVariable =
        new ContentFile(Map.of(), Map.of("v", " "), Map.of(), Map.of(), Map.of(), Map.of());
    assertThat(problems(new Sourced("a.yml", blankVariable))).asString().contains("description");
    var badTemplate =
        new ContentFile(
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of(
                "t", new TemplateEntry("hourly", "kill", "n", "o", "a", "d", "f", 1, List.of())));
    assertThat(problems(new Sourced("a.yml", badTemplate)))
        .extracting(ContentProblem::path)
        .contains("templates.t.period");
  }
}
