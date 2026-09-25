package com.shepherdjerred.thestorm.npcs.domain.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler.Sourced;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.DialogueEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.NodeEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.NpcEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.OptionEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.ScheduleEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.SkinEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.SlotEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.SpotEntry;
import com.shepherdjerred.thestorm.npcs.domain.geo.ChunkKey;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.npc.Skin;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Activity;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ContentCompilerTest {

  private static final String WORLD = "minecraft:overworld";
  private static final ContentRules RULES =
      new ContentRules(Set.of(WORLD, "minecraft:the_nether"), Set.of("shopkeeper", "mechanic"));

  private static SpotEntry at(double x, double z) {
    return new SpotEntry(WORLD, x, 64, z, 0, 0);
  }

  private static NpcEntry npc(String skin, String schedule, String dialogue, String trainer) {
    return new NpcEntry(
        "Stan · Trainer",
        "Teaches",
        skin,
        at(0.5, 0.5),
        "standing",
        List.of("trainer"),
        schedule,
        dialogue,
        trainer);
  }

  private static final ScheduleEntry DAY =
      new ScheduleEntry(
          "inn",
          List.of(
              new SlotEntry("06:00", "20:00", "wander market 4"),
              new SlotEntry("20:00", "06:00", "sleep home")));

  private static final DialogueEntry TALK =
      new DialogueEntry(
          "Stan",
          "greet",
          Map.of(
              "greet",
              new NodeEntry(
                  "Hello",
                  "none",
                  List.of(
                      new OptionEntry("Train", "trainer"),
                      new OptionEntry("More", "goto:more"),
                      new OptionEntry("Bye", "close"))),
              "more",
              new NodeEntry("More text", "greet", List.of())));

  private static ContentFile valid() {
    return new ContentFile(
        Map.of("market", at(10.5, 10.5), "inn", at(-20.5, 3.5)),
        Map.of("stan-skin", new SkinEntry("dmFsdWU=", "c2lnbmF0dXJl")),
        Map.of("day", DAY),
        Map.of("stan", TALK),
        Map.of(
            "stan", npc("stan-skin", "day", "stan", "shopkeeper"),
            "braxton", npc("vanilla:slim/alex", "none", "none", "none")));
  }

  private static Result<Content, List<ContentProblem>> compile(ContentFile... files) {
    var sourced = new java.util.ArrayList<Sourced>();
    for (var i = 0; i < files.length; i++) {
      sourced.add(new Sourced("npcs/f" + i + ".yml", files[i]));
    }
    return ContentCompiler.compile(sourced, RULES);
  }

  private static Content ok(ContentFile... files) {
    return compile(files)
        .fold(
            content -> content,
            problems -> {
              throw new AssertionError(problems.toString());
            });
  }

  private static List<String> problems(ContentFile... files) {
    return compile(files)
        .fold(
            content -> List.<String>of(),
            found -> found.stream().map(ContentProblem::toString).toList());
  }

  @Test
  void compilesAValidFile() {
    var content = ok(valid());
    var stan = content.npc("stan").orElseThrow();
    assertThat(stan.skin()).isEqualTo(new Skin.Signed("stan-skin", "dmFsdWU=", "c2lnbmF0dXJl"));
    assertThat(stan.pose()).isEqualTo(NpcPose.STANDING);
    assertThat(stan.schedule()).contains("day");
    assertThat(stan.dialogue()).contains("stan");
    assertThat(stan.trainer()).contains("shopkeeper");
    assertThat(stan.roles()).containsExactly("trainer");
    var braxton = content.npc("braxton").orElseThrow();
    assertThat(braxton.skin()).isEqualTo(new Skin.Vanilla(Skin.Model.SLIM, "alex"));
    assertThat(braxton.schedule()).isEmpty();
    assertThat(braxton.dialogue()).isEmpty();
    assertThat(braxton.trainer()).isEmpty();
    var schedule = content.schedule(stan).orElseThrow();
    assertThat(schedule.shelter()).contains("inn");
    assertThat(schedule.slots().getFirst().activity()).isEqualTo(new Activity.Wander("market", 4));
    var dialogue = content.dialogue(stan).orElseThrow();
    assertThat(
            java.util.Objects.requireNonNull(dialogue.nodes().get("greet"))
                .options()
                .getFirst()
                .effect())
        .isEqualTo(new OptionEffect.OpenTrainer());
    assertThat(content.sortedNpcs()).extracting(n -> n.id()).containsExactly("braxton", "stan");
  }

  @Test
  void holdsChunksForHomesPlacesAndWanderAreas() {
    var chunks = ok(valid()).chunks();
    // Homes at 0.5,0.5 reach into the chunks around the origin; the inn is at x -20.5.
    assertThat(chunks)
        .contains(
            new ChunkKey(WORLD, 0, 0), new ChunkKey(WORLD, -1, -1), new ChunkKey(WORLD, -2, 0));
    // Wandering 4 (+2) blocks around the market at 10.5 reaches x 16.5: chunk 1.
    assertThat(chunks).contains(new ChunkKey(WORLD, 1, 1));
    assertThat(chunks).noneMatch(chunk -> chunk.x() > 1 || chunk.z() > 1);
  }

  @Test
  void idsAreGlobalAcrossFiles() {
    var second =
        new ContentFile(
            Map.of("market", at(0, 0)),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("stan", npc("none", "none", "none", "none")));
    assertThat(problems(valid(), second))
        .containsExactly(
            "npcs/f1.yml at places.market: duplicate id; also defined in npcs/f0.yml",
            "npcs/f1.yml at npcs.stan: duplicate id; also defined in npcs/f0.yml");
  }

  @Test
  void referencesMayCrossFiles() {
    var places =
        new ContentFile(
            Map.of("market", at(10.5, 10.5), "inn", at(-20.5, 3.5)),
            Map.of(),
            Map.of("day", DAY),
            Map.of(),
            Map.of());
    var people =
        new ContentFile(
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("nat", npc("none", "day", "none", "none")));
    assertThat(ok(places, people).npc("nat").orElseThrow().schedule()).contains("day");
  }

  @Test
  void rejectsBadIdsAndTheReservedHomePlace() {
    var content =
        new ContentFile(
            Map.of("home", at(0, 0), "Bad Id", at(0, 0)),
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("none", npc("none", "none", "none", "none")));
    assertThat(problems(content))
        .containsExactlyInAnyOrder(
            "npcs/f0.yml at places.Bad Id: " + Ids.RULE,
            "npcs/f0.yml at places.home: home is reserved: it always means the NPC's own home",
            "npcs/f0.yml at npcs.none: " + Ids.RULE);
  }

  @Test
  void rejectsUnloadedWorldsAndBadAngles() {
    var nowhere = new SpotEntry("minecraft:the_end", 0, 64, 0, 0, 0);
    var tilted = new SpotEntry(WORLD, 0, 64, 0, 0, 120);
    assertThat(
            problems(
                new ContentFile(
                    Map.of("void", nowhere, "tilt", tilted),
                    Map.of(),
                    Map.of(),
                    Map.of(),
                    Map.of())))
        .containsExactlyInAnyOrder(
            "npcs/f0.yml at places.void: world minecraft:the_end is not loaded; loaded worlds: [minecraft:overworld, minecraft:the_nether]",
            "npcs/f0.yml at places.tilt: pitch must be -90..90: 120.0");
  }

  @Test
  void rejectsBadNpcFields() {
    var bad =
        new NpcEntry(
            "",
            "d".repeat(65),
            "vanilla:wide/herobrine",
            new SpotEntry("minecraft:the_end", 0, 64, 0, 0, 0),
            "dancing",
            List.of("trainer", "trainer", "Bad"),
            "missing",
            "missing",
            "farmer");
    assertThat(problems(new ContentFile(Map.of(), Map.of(), Map.of(), Map.of(), Map.of("x", bad))))
        .containsExactlyInAnyOrder(
            "npcs/f0.yml at npcs.x.name: name must be 1..48 characters",
            "npcs/f0.yml at npcs.x.description: description must be 0..64 characters",
            "npcs/f0.yml at npcs.x.skin: unknown built-in skin herobrine; one of "
                + Skin.Vanilla.NAMES,
            "npcs/f0.yml at npcs.x.home: world minecraft:the_end is not loaded; loaded worlds: [minecraft:overworld, minecraft:the_nether]",
            "npcs/f0.yml at npcs.x.pose: pose must be one of [standing, sneaking, sleeping, swimming, fall_flying]",
            "npcs/f0.yml at npcs.x.roles: role trainer is listed twice",
            "npcs/f0.yml at npcs.x.roles: role Bad: " + Ids.RULE,
            "npcs/f0.yml at npcs.x.schedule: schedule missing is not defined; write none for no schedule",
            "npcs/f0.yml at npcs.x.dialogue: dialogue missing is not defined; write none for no dialogue",
            "npcs/f0.yml at npcs.x.trainer: trainer must be none or a track: [mechanic, shopkeeper]");
  }

  @Test
  void rejectsBadSkinReferences() {
    assertThat(
            problems(
                new ContentFile(
                    Map.of(),
                    Map.of(),
                    Map.of(),
                    Map.of(),
                    Map.of("x", npc("vanilla:wide", "none", "none", "none")))))
        .containsExactly(
            "npcs/f0.yml at npcs.x.skin: write vanilla:wide/<name> or vanilla:slim/<name>: vanilla:wide");
    assertThat(
            problems(
                new ContentFile(
                    Map.of(),
                    Map.of(),
                    Map.of(),
                    Map.of(),
                    Map.of("x", npc("ghost", "none", "none", "none")))))
        .containsExactly(
            "npcs/f0.yml at npcs.x.skin: skin must be none, vanilla:<wide|slim>/<name> or a skin id under skins: ghost");
    assertThat(
            problems(
                new ContentFile(
                    Map.of(),
                    Map.of("blank", new SkinEntry("", "sig")),
                    Map.of(),
                    Map.of(),
                    Map.of())))
        .containsExactly("npcs/f0.yml at skins.blank: skin blank needs a value and a signature");
  }

  @Test
  void aTrainerButtonNeedsATrainer() {
    var content =
        new ContentFile(
            Map.of(),
            Map.of(),
            Map.of(),
            Map.of("stan", TALK),
            Map.of("x", npc("none", "none", "stan", "none")));
    assertThat(problems(content))
        .containsExactly(
            "npcs/f0.yml at npcs.x.dialogue: dialogue stan opens a trainer, but this NPC trains no track");
  }

  @Test
  void rejectsBadSchedules() {
    var broken =
        new ScheduleEntry(
            "nowhere",
            List.of(
                new SlotEntry("6am", "18:00", "stay home"),
                new SlotEntry("18:00", "06:00", "stay nowhere"),
                new SlotEntry("06:00", "06:00", "juggle")));
    var gappy = new ScheduleEntry("none", List.of(new SlotEntry("06:00", "18:00", "stay home")));
    assertThat(
            problems(
                new ContentFile(
                    Map.of(),
                    Map.of(),
                    Map.of("broken", broken, "gappy", gappy),
                    Map.of(),
                    Map.of())))
        .containsExactlyInAnyOrder(
            "npcs/f0.yml at schedules.broken.shelter: place nowhere is not defined under places (or use home)",
            "npcs/f0.yml at schedules.broken.slots[0].from: time must be HH:MM on a 24-hour clock, such as 06:00 or 22:30: 6am",
            "npcs/f0.yml at schedules.broken.slots[1].activity: place nowhere is not defined under places (or use home)",
            "npcs/f0.yml at schedules.broken.slots[2].activity: unknown activity \"juggle\"; write stay <place>, wander <place> <radius>, patrol <place> <place>... or sleep <place>",
            "npcs/f0.yml at schedules.gappy.slots: no slot covers 00:00-06:00",
            "npcs/f0.yml at schedules.gappy.slots: no slot covers 18:00-00:00");
  }

  @Test
  void aBrokenScheduleIsReportedOnceNotByEveryNpc() {
    var gappy = new ScheduleEntry("none", List.of(new SlotEntry("06:00", "18:00", "stay home")));
    var content =
        new ContentFile(
            Map.of(),
            Map.of(),
            Map.of("gappy", gappy),
            Map.of(),
            Map.of("x", npc("none", "gappy", "none", "none")));
    assertThat(problems(content)).allMatch(problem -> problem.contains("schedules.gappy"));
  }

  @Test
  void schedulesStayInTheNpcsWorld() {
    var nether = new SpotEntry("minecraft:the_nether", 0, 64, 0, 0, 0);
    var away = new ScheduleEntry("none", List.of(new SlotEntry("00:00", "00:00", "stay fortress")));
    var content =
        new ContentFile(
            Map.of("fortress", nether),
            Map.of(),
            Map.of("away", away),
            Map.of(),
            Map.of("x", npc("none", "away", "none", "none")));
    assertThat(problems(content))
        .containsExactly(
            "npcs/f0.yml at npcs.x.schedule: schedule away sends this NPC to fortress in minecraft:the_nether, but it lives in minecraft:overworld");
  }

  @Test
  void rejectsBadDialogues() {
    var nodes = new LinkedHashMap<String, NodeEntry>();
    nodes.put(
        "greet",
        new NodeEntry(
            "Hi",
            "none",
            List.of(new OptionEntry("Go", "teleport"), new OptionEntry("Go", "goto:"))));
    var badThen = new DialogueEntry("Stan", "greet", nodes);
    var unreachable =
        new DialogueEntry(
            "Nat",
            "a",
            Map.of(
                "a", new NodeEntry("A", "none", List.of(new OptionEntry("Bye", "close"))),
                "b", new NodeEntry("B", "a", List.of())));
    var untitled =
        new DialogueEntry(
            " ",
            "a",
            Map.of("a", new NodeEntry("A", "none", List.of(new OptionEntry("Bye", "close")))));
    assertThat(
            problems(
                new ContentFile(
                    Map.of(),
                    Map.of(),
                    Map.of(),
                    Map.of("s", badThen, "n", unreachable, "u", untitled),
                    Map.of())))
        .containsExactlyInAnyOrder(
            "npcs/f0.yml at dialogues.s.nodes.greet.options[0].then: then must be close, trainer, goto:<node> or action:<module.action>, not \"teleport\"",
            "npcs/f0.yml at dialogues.s.nodes.greet.options[1].then: then must be close, trainer, goto:<node> or action:<module.action>, not \"goto:\"",
            "npcs/f0.yml at dialogues.n: node b is unreachable from a",
            "npcs/f0.yml at dialogues.u.title: title must not be blank");
  }

  @Test
  void parsesEveryOptionEffect() {
    assertThat(DialogueCompiler.effect("close")).isEqualTo(Result.ok(new OptionEffect.Close()));
    assertThat(DialogueCompiler.effect("trainer"))
        .isEqualTo(Result.ok(new OptionEffect.OpenTrainer()));
    assertThat(DialogueCompiler.effect("goto:shop"))
        .isEqualTo(Result.ok(new OptionEffect.Goto("shop")));
    assertThat(DialogueCompiler.effect("action:quests.accept"))
        .isEqualTo(Result.ok(new OptionEffect.RunAction("quests.accept")));
    assertThat(DialogueCompiler.effect("action:").isOk()).isFalse();
    assertThat(DialogueCompiler.effect("Close").isOk()).isFalse();
  }

  @Test
  void anEmptySetOfFilesIsNoNpcs() {
    assertThat(ok().npcs()).isEmpty();
    assertThat(Content.empty().chunks()).isEmpty();
  }
}
