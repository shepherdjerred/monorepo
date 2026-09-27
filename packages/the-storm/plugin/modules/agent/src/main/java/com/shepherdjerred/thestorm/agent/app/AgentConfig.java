package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.FaqEntry;
import com.shepherdjerred.thestorm.agent.domain.Ladder;
import com.shepherdjerred.thestorm.agent.domain.LadderAction;
import com.shepherdjerred.thestorm.agent.domain.LadderStep;
import com.shepherdjerred.thestorm.agent.domain.LadderTable;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.agent.domain.PrefilterLimits;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;

/**
 * {@code plugins/TheStorm/agent.yml}: the mode, the confidence bars, the pre-filter limits, the
 * enforcement ladders, and the review sample rate. Every key is required: a half-configured agent
 * must fail to boot, never arm itself on defaults. An empty ladder list is a watching agent:
 * everything enforcible escalates.
 *
 * @param mode {@code shadow} watches without acting, {@code active} enforces
 * @param classifyThreshold the confidence that enforces chat classifications, 0-1 exclusive of 0
 * @param triageThreshold the confidence that attaches triage, 0-1 exclusive of 0
 * @param resolveThreshold the confidence that resolves tickets outright, 0-1 exclusive of 0
 * @param prefilters the deterministic pre-filter limits
 * @param ladders the ladders, one per offense at most
 * @param reviewSamplePercent how many autonomous decisions surface for spot-checks, 0-100
 * @param brain where the storm-brain service lives and how to call it
 * @param sweep how the stale-ticket sweep redrives and escalates
 * @param serverId which server this agent staffs, for example {@code survival}
 * @param faq the known-answer catalog for ticket deflection
 * @param onboarding the new-player greeting
 */
public record AgentConfig(
    String mode,
    double classifyThreshold,
    double triageThreshold,
    double resolveThreshold,
    PrefilterFile prefilters,
    List<LadderFile> ladders,
    int reviewSamplePercent,
    BrainFile brain,
    SweepFile sweep,
    String serverId,
    FaqFile faq,
    OnboardingFile onboarding) {

  /** Watches without acting. */
  public static final String SHADOW = "shadow";

  /** Enforces. */
  public static final String ACTIVE = "active";

  private static final Pattern VARIABLE = Pattern.compile("[A-Z][A-Z0-9_]*");
  private static final Pattern SLUG = Pattern.compile("[a-z0-9-]{1,40}");
  private static final Pattern SERVER_ID = Pattern.compile("[a-z0-9-]{1,32}");

  public AgentConfig {
    if (!SHADOW.equals(mode) && !ACTIVE.equals(mode)) {
      throw new IllegalArgumentException("mode must be shadow or active");
    }
    if (!(classifyThreshold > 0 && classifyThreshold <= 1)) {
      throw new IllegalArgumentException("classifyThreshold must be above 0 through 1");
    }
    if (!(triageThreshold > 0 && triageThreshold <= 1)) {
      throw new IllegalArgumentException("triageThreshold must be above 0 through 1");
    }
    if (!(resolveThreshold > 0 && resolveThreshold <= 1)) {
      throw new IllegalArgumentException("resolveThreshold must be above 0 through 1");
    }
    if (prefilters == null) {
      throw new IllegalArgumentException("prefilters must be present");
    }
    if (brain == null) {
      throw new IllegalArgumentException("brain must be present");
    }
    if (sweep == null) {
      throw new IllegalArgumentException("sweep must be present");
    }
    if (reviewSamplePercent < 0 || reviewSamplePercent > 100) {
      throw new IllegalArgumentException("reviewSamplePercent must be 0-100");
    }
    if (serverId == null || !SERVER_ID.matcher(serverId).matches()) {
      throw new IllegalArgumentException(
          "serverId must be 1-32 lowercase letters, digits, or dashes");
    }
    if (faq == null) {
      throw new IllegalArgumentException("faq must be present");
    }
    if (onboarding == null) {
      throw new IllegalArgumentException("onboarding must be present");
    }
    ladders = List.copyOf(ladders);
    var seen = new HashSet<String>();
    for (var ladder : ladders) {
      if (!seen.add(ladder.offense())) {
        throw new IllegalArgumentException("duplicate ladder: " + ladder.offense());
      }
    }
  }

  /** Whether the agent watches without acting. */
  public boolean shadow() {
    return SHADOW.equals(mode);
  }

  /** The ladders as the agent evaluates them. */
  public LadderTable table() {
    return new LadderTable(ladders.stream().map(LadderFile::toDomain).toList());
  }

  /** The pre-filter limits as the checks evaluate them. */
  public PrefilterLimits limits() {
    return prefilters.toDomain();
  }

  /**
   * One offense's ladder, as written.
   *
   * @param offense the offense id, for example {@code grief}
   * @param repeatWithin how long a strike counts, for example {@code 7d}
   * @param steps the rungs, first offense first
   */
  public record LadderFile(String offense, String repeatWithin, List<StepFile> steps) {

    public LadderFile {
      if (steps.isEmpty()) {
        throw new IllegalArgumentException(offense + " needs at least one step");
      }
      steps = List.copyOf(steps);
      // Static: fields are not assigned yet when a compact constructor runs.
      var _ = toDomain(offense, repeatWithin, steps);
    }

    Ladder toDomain() {
      return toDomain(offense, repeatWithin, steps);
    }

    private static Ladder toDomain(String offense, String repeatWithin, List<StepFile> steps) {
      return new Ladder(
          Offense.fromId(offense), repeatWithin, steps.stream().map(StepFile::toDomain).toList());
    }
  }

  /**
   * One rung, as written.
   *
   * @param action the action id, for example {@code mute}
   * @param duration how long, or {@code none}
   */
  public record StepFile(String action, String duration) {

    public StepFile {
      // Static: fields are not assigned yet when a compact constructor runs.
      var _ = toDomain(action, duration);
    }

    LadderStep toDomain() {
      return toDomain(action, duration);
    }

    private static LadderStep toDomain(String action, String duration) {
      return new LadderStep(LadderAction.fromId(action), duration);
    }
  }

  /**
   * The storm-brain service, as written. The token never lives here: the file names the environment
   * variable that holds it, and the module refuses to start without it.
   *
   * @param baseUrl the service origin, for example {@code http://storm-brain:3000}
   * @param bearerTokenEnv the environment variable holding the service bearer token
   * @param timeoutMs how long a brain call may take; past the service's own LLM timeout, so a slow
   *     model surfaces as the service's answer rather than a client timeout
   */
  public record BrainFile(String baseUrl, String bearerTokenEnv, int timeoutMs) {

    public BrainFile {
      var uri = parse(baseUrl);
      if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) {
        throw new IllegalArgumentException("brain.baseUrl must be an http(s) URL: " + baseUrl);
      }
      if (uri.getHost() == null) {
        throw new IllegalArgumentException("brain.baseUrl must name a host: " + baseUrl);
      }
      if (!VARIABLE.matcher(bearerTokenEnv).matches()) {
        throw new IllegalArgumentException(
            "brain.bearerTokenEnv must name an environment variable: " + bearerTokenEnv);
      }
      if (timeoutMs < 1000 || timeoutMs > 300_000) {
        throw new IllegalArgumentException("brain.timeoutMs must be 1000-300000");
      }
    }

    private static URI parse(String baseUrl) {
      try {
        return new URI(baseUrl);
      } catch (URISyntaxException bad) {
        throw new IllegalArgumentException("brain.baseUrl must be an http(s) URL: " + baseUrl, bad);
      }
    }
  }

  /**
   * The stale-ticket sweep, as written. Every sweep re-drives open tickets the brain never triaged
   * and escalates open tickets older than the SLA. SLA wins ties: a ticket past both bars escalates
   * instead of redriving.
   *
   * @param intervalMinutes how often the sweep runs while the server is awake
   * @param redriveAfterMinutes how old an untriaged ticket must be before the sweep works it again
   * @param redriveBackoffMinutes how long a ticket rests after a re-drive attempt; 0 disables
   * @param slaAfterMinutes how old an open ticket must be before the sweep escalates it
   */
  public record SweepFile(
      int intervalMinutes,
      int redriveAfterMinutes,
      int redriveBackoffMinutes,
      int slaAfterMinutes) {

    public SweepFile {
      if (intervalMinutes < 1 || intervalMinutes > 1440) {
        throw new IllegalArgumentException("sweep.intervalMinutes must be 1-1440");
      }
      if (redriveAfterMinutes < 0 || redriveAfterMinutes > 10080) {
        throw new IllegalArgumentException("sweep.redriveAfterMinutes must be 0-10080");
      }
      if (redriveBackoffMinutes < 0 || redriveBackoffMinutes > 10080) {
        throw new IllegalArgumentException("sweep.redriveBackoffMinutes must be 0-10080");
      }
      if (slaAfterMinutes < 0 || slaAfterMinutes > 10080) {
        throw new IllegalArgumentException("sweep.slaAfterMinutes must be 0-10080");
      }
    }
  }

  /**
   * The deterministic pre-filter limits, as written.
   *
   * @param maxLines how many lines per player per window pass before the rate trip fires
   * @param windowSeconds the rate and repeat window
   * @param maxLength the longest message that is not a flood
   * @param maxRepeats how many identical messages per player per window pass
   * @param capsMinLength the shortest message the caps signal considers
   * @param capsPercent the uppercase share, 1-100, that sends a message to the brain
   */
  public record PrefilterFile(
      int maxLines,
      int windowSeconds,
      int maxLength,
      int maxRepeats,
      int capsMinLength,
      int capsPercent) {

    public PrefilterFile {
      var _ =
          new PrefilterLimits(
              maxLines, windowSeconds, maxLength, maxRepeats, capsMinLength, capsPercent);
    }

    PrefilterLimits toDomain() {
      return new PrefilterLimits(
          maxLines, windowSeconds, maxLength, maxRepeats, capsMinLength, capsPercent);
    }
  }

  /**
   * The known-answer catalog, as written. New tickets whose text names an entry's keyword get the
   * entry's reply; repeat askers get the reply cut once two prior askings are still remembered. An
   * empty catalog answers nothing.
   *
   * @param enabled whether new tickets are matched against the catalog
   * @param halfLifeHours how fast repeat-asker hits fade, in hours
   * @param entries the answers, first match wins
   */
  public record FaqFile(boolean enabled, int halfLifeHours, List<FaqEntryFile> entries) {

    public FaqFile {
      if (halfLifeHours < 1 || halfLifeHours > 720) {
        throw new IllegalArgumentException("faq.halfLifeHours must be 1-720");
      }
      entries = List.copyOf(entries);
      var seen = new HashSet<String>();
      for (var entry : entries) {
        if (!seen.add(entry.id())) {
          throw new IllegalArgumentException("duplicate faq entry: " + entry.id());
        }
      }
    }
  }

  /**
   * One known answer, as written.
   *
   * @param id the slug, for example {@code starter-kit}
   * @param keywords trigger phrases, matched case-insensitively against the ticket text
   * @param reply the answer, posted publicly
   * @param link where to read more; blank when there is nowhere
   */
  public record FaqEntryFile(String id, List<String> keywords, String reply, String link) {

    public FaqEntryFile {
      if (id == null || !SLUG.matcher(id).matches()) {
        throw new IllegalArgumentException(
            "faq entry id must be 1-40 lowercase letters, digits, or dashes");
      }
      if (keywords.size() < 1 || keywords.size() > 10) {
        throw new IllegalArgumentException("faq entry " + id + " needs 1-10 keywords");
      }
      for (var keyword : keywords) {
        if (keyword == null || keyword.isBlank() || keyword.strip().length() > 60) {
          throw new IllegalArgumentException(
              "faq entry " + id + " keywords must be 1-60 characters");
        }
      }
      keywords = List.copyOf(keywords);
      if (reply == null || reply.isBlank() || reply.strip().length() > 1000) {
        throw new IllegalArgumentException("faq entry " + id + " reply must be 1-1000 characters");
      }
      if (link == null || link.strip().length() > 300) {
        throw new IllegalArgumentException(
            "faq entry " + id + " link must be at most 300 characters");
      }
    }

    FaqEntry toDomain() {
      return new FaqEntry(id, keywords, reply.strip(), link.strip());
    }
  }

  /**
   * The new-player greeting, as written. Essentials already teleports and kits first-joiners; this
   * is the staff voice on top: starter tips and where to read more.
   *
   * @param enabled whether first-joiners are greeted
   * @param lines the greeting, one chat line each
   */
  public record OnboardingFile(boolean enabled, List<String> lines) {

    public OnboardingFile {
      if (lines.size() > 8) {
        throw new IllegalArgumentException("onboarding needs at most 8 lines");
      }
      for (var line : lines) {
        if (line == null || line.isBlank() || line.strip().length() > 300) {
          throw new IllegalArgumentException("onboarding lines must be 1-300 characters");
        }
      }
      lines = List.copyOf(lines);
      if (enabled && lines.isEmpty()) {
        throw new IllegalArgumentException("onboarding needs at least one line when enabled");
      }
    }
  }
}
