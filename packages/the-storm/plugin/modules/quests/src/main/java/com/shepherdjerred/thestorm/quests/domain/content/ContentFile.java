package com.shepherdjerred.thestorm.quests.domain.content;

import java.util.List;
import java.util.Map;

/**
 * One file under {@code plugins/TheStorm/quests/}, exactly as written. Every section is required
 * (write {@code {}} for an empty one) and ids are global across files. Optional values are written
 * as {@code none}. {@link ContentCompiler} turns the files into {@link QuestContent}.
 *
 * <p>Objectives, conditions and actions are one-line strings; see {@link Dsl} for the grammar.
 *
 * @param factions groups players earn reputation with
 * @param variables quest variables and flags, with what each means; using an undeclared one is an
 *     error
 * @param regions named spheres for reach objectives, region conditions, teleports and spawns
 * @param hooks custom objective and action ids other modules report through {@code QuestHooks}
 * @param quests the quests
 * @param templates radiant board templates
 */
public record ContentFile(
    Map<String, FactionEntry> factions,
    Map<String, String> variables,
    Map<String, RegionEntry> regions,
    Map<String, String> hooks,
    Map<String, QuestEntry> quests,
    Map<String, TemplateEntry> templates) {

  /** A faction and its named reputation ranks, lowest first. */
  public record FactionEntry(String name, List<RankEntry> ranks) {}

  /** A named reputation threshold. */
  public record RankEntry(String name, long from) {}

  /** A sphere: centre and radius in blocks. */
  public record RegionEntry(
      String name, String world, double x, double y, double z, double radius) {}

  /**
   * A quest.
   *
   * @param giver the NPC id who offers it
   * @param category {@code story}, {@code side}, {@code daily}, {@code weekly}, {@code track} or
   *     {@code hidden}
   * @param repeat {@code once}, {@code daily} or {@code weekly}
   * @param estimatedMinutes how long a typical player takes, for the reward budget
   * @param requirements conditions to be offered it
   * @param start the first stage id
   * @param onAccept actions run on accepting
   * @param rewards actions run on completing
   */
  public record QuestEntry(
      String name,
      String giver,
      String category,
      String repeat,
      int estimatedMinutes,
      List<String> requirements,
      TextEntry text,
      String start,
      Map<String, StageEntry> stages,
      List<String> onAccept,
      List<String> rewards) {}

  /** What the giver says. */
  public record TextEntry(
      String offer,
      String accept,
      String decline,
      String finish,
      String summary,
      List<QuestionEntry> questions) {}

  /** A question the player may ask before accepting. */
  public record QuestionEntry(String label, String answer) {}

  /**
   * A stage.
   *
   * @param waiting what the stage's NPC says mid-stage, or {@code none}
   * @param complete what the NPC says when the stage is done, or {@code none}
   * @param next branches: all guarded ({@code label: none}) or all labelled choices
   * @param timeLimit {@code none}, or a duration and target such as {@code 30m fail}
   */
  public record StageEntry(
      String journal,
      String waiting,
      String complete,
      List<String> objectives,
      List<String> onComplete,
      List<BranchEntry> next,
      String timeLimit) {}

  /**
   * A branch.
   *
   * @param to a stage id, {@code complete} or {@code fail}
   * @param when conditions for a guarded branch (empty for always)
   * @param label the button for a choice, or {@code none} for a guarded branch
   */
  public record BranchEntry(String to, List<String> when, String label) {}

  /**
   * A board template: one kind of daily or weekly quest with a table of targets.
   *
   * @param period {@code daily} or {@code weekly}
   * @param kind {@code kill} (kill, then report to the board) or {@code deliver} (bring items to
   *     the board)
   * @param name the quest name; {@code {amount}} and {@code {target}} are filled in
   * @param offer the offer text, with the same placeholders
   * @param accept what the board NPC says when the quest is taken
   * @param decline what the board NPC says when it is declined
   * @param finish what the board NPC says on completion
   * @param baseReward crystals paid on top of each target's per-unit reward
   * @param targets what the quest may ask for
   */
  public record TemplateEntry(
      String period,
      String kind,
      String name,
      String offer,
      String accept,
      String decline,
      String finish,
      long baseReward,
      List<TargetEntry> targets) {}

  /**
   * A board target.
   *
   * @param id an entity type (kill) or material (deliver)
   * @param difficulty how hard one unit is, for the star rating
   * @param min the fewest asked for
   * @param max the most asked for
   * @param reward crystals per unit
   * @param minutes estimated minutes per unit, for the reward budget
   */
  public record TargetEntry(
      String id, double difficulty, int min, int max, long reward, double minutes) {}
}
