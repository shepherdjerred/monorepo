package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Moment;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Placeholder;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.random.RandomGenerator;
import java.util.regex.Pattern;

/**
 * Decides who says what in one match. Given a moment and the match after it, it picks which bots
 * (if any) speak and which of their lines, and when: a greet from any bot when the match goes live,
 * a brag from the killer or a reaction from the victim, a plant or defuse line from the bomb
 * worker, a line from the last bot standing on a team, a win or loss line from any bot at the end,
 * and now and then an idle taunt from a living bot.
 *
 * <p>Only bots in the match speak, and outside the end of the match only while alive or for {@code
 * recentDeath} after dying. Each bot waits {@code botCooldown} between lines and never repeats a
 * line within the match; all bots together keep {@code minGap} between lines and say at most {@code
 * maxLinesPerWindow} per {@code window}. A line the limit would delay by more than {@code maxDelay}
 * is dropped. Chances follow {@link Chattiness}. A bot with {@code ALWAYS_GG} always says a win or
 * loss line, preferring one that says gg. Every draw comes from the generator it was built with, so
 * a match replays the same chat from the same seed. One instance per match; not thread-safe.
 */
public final class ChatDirector {

  private static final Pattern GG = Pattern.compile("(?i)\\bgg\\b");

  private final ChatSettings settings;
  private final RandomGenerator random;
  private final Map<UUID, Instant> lastSpoke = new HashMap<>();
  private final Map<UUID, Set<String>> said = new HashMap<>();
  private final Map<UUID, Instant> diedAt = new HashMap<>();
  private final Map<UUID, UUID> lastKilledBy = new HashMap<>();
  private final Set<String> lastAliveTeams = new HashSet<>();
  private final ArrayDeque<Instant> spoken = new ArrayDeque<>();
  private Instant nextTaunt;
  private boolean ended;

  /** A director for a match that went live at {@code startedAt}. */
  public ChatDirector(ChatSettings settings, RandomGenerator random, Instant startedAt) {
    this.settings = settings;
    this.random = random;
    this.nextTaunt = startedAt.plus(tauntWait());
  }

  /** One bot that may speak at this moment, with what its line may name. */
  private record Candidate(
      ChatScene.Member member,
      Personality bot,
      Moment moment,
      Chattiness.Context context,
      Map<Placeholder, String> values) {}

  /** A candidate that passed its roll, with the line it drew. */
  private record Pick(Candidate candidate, String line) {}

  /** What the bots say about {@code moment}, given the match {@code scene} after it, in order. */
  public List<Utterance> on(ChatMoment moment, ChatScene scene, Instant now) {
    if (ended) {
      return List.of();
    }
    prune(now);
    var lines = new ArrayList<Utterance>();
    switch (moment) {
      case ChatMoment.Started _ -> {
        for (var team : scene.teams()) {
          if (scene.alive(team).size() <= 1) {
            // A team of one is not a last stand.
            lastAliveTeams.add(team);
          }
        }
        lines.addAll(speak(everyBot(scene, Moment.GREET, Optional.empty()), true, now));
      }
      case ChatMoment.Died died -> {
        diedAt.put(died.victim(), now);
        died.killer().ifPresent(killer -> lastKilledBy.put(died.victim(), killer));
        lines.addAll(speak(died(died, scene), false, now));
      }
      case ChatMoment.Planted planted ->
          lines.addAll(
              speak(
                  worker(
                      required(scene, planted.planter()),
                      Moment.ON_PLANT,
                      planted.bomb(),
                      new Chattiness.Context(false, planted.nuke())),
                  false,
                  now));
      case ChatMoment.Defused defused ->
          lines.addAll(
              speak(
                  worker(
                      required(scene, defused.defuser()),
                      Moment.ON_DEFUSE,
                      defused.bomb(),
                      Chattiness.Context.PLAIN),
                  false,
                  now));
      case ChatMoment.Ended end -> {
        ended = true;
        if (end.winner().isPresent()) {
          lines.addAll(speak(everyBot(scene, Moment.ON_WIN, end.winner()), true, now));
        }
        return List.copyOf(lines);
      }
      case ChatMoment.Idle _ -> {
        if (!now.isBefore(nextTaunt)) {
          nextTaunt = now.plus(tauntWait());
          lines.addAll(speak(taunters(scene), false, now));
        }
      }
    }
    lines.addAll(speak(lastAlive(scene), false, now));
    return List.copyOf(lines);
  }

  /** Every bot on a team; at the end each says a win line if its team won, else a loss line. */
  private List<Candidate> everyBot(ChatScene scene, Moment moment, Optional<String> winner) {
    var candidates = new ArrayList<Candidate>();
    for (var member : scene.members()) {
      if (member.bot().isEmpty() || member.team().isEmpty()) {
        continue;
      }
      var team = member.team().orElseThrow();
      var actual =
          moment == Moment.ON_WIN && !winner.orElseThrow().equals(team) ? Moment.ON_LOSS : moment;
      candidates.add(
          new Candidate(
              member,
              member.bot().orElseThrow(),
              actual,
              Chattiness.Context.PLAIN,
              Map.of(Placeholder.TEAM, team)));
    }
    return candidates;
  }

  private List<Candidate> died(ChatMoment.Died died, ChatScene scene) {
    var victim = required(scene, died.victim());
    var killer = died.killer().map(uuid -> required(scene, uuid));
    var candidates = new ArrayList<Candidate>();
    if (killer.isPresent()) {
      var by = killer.orElseThrow();
      if (by.bot().isPresent() && by.team().isPresent()) {
        var bot = by.bot().orElseThrow();
        var aimed =
            rival(bot, victim)
                || (bot.quirks().contains(Quirk.HOLDS_GRUDGES)
                    && victim.uuid().equals(lastKilledBy.get(by.uuid())));
        candidates.add(
            new Candidate(
                by,
                bot,
                Moment.ON_KILL,
                new Chattiness.Context(aimed, false),
                Map.of(
                    Placeholder.VICTIM, victim.name(), Placeholder.TEAM, by.team().orElseThrow())));
      }
    }
    if (victim.bot().isPresent() && victim.team().isPresent()) {
      var bot = victim.bot().orElseThrow();
      var values = new EnumMap<Placeholder, String>(Placeholder.class);
      values.put(Placeholder.TEAM, victim.team().orElseThrow());
      killer.ifPresent(by -> values.put(Placeholder.KILLER, by.name()));
      var aimed = killer.filter(by -> rival(bot, by)).isPresent();
      candidates.add(
          new Candidate(
              victim, bot, Moment.ON_DEATH, new Chattiness.Context(aimed, false), values));
    }
    return candidates;
  }

  private static List<Candidate> worker(
      ChatScene.Member member, Moment moment, String bomb, Chattiness.Context context) {
    if (member.bot().isEmpty() || member.team().isEmpty()) {
      return List.of();
    }
    return List.of(
        new Candidate(
            member,
            member.bot().orElseThrow(),
            moment,
            context,
            Map.of(Placeholder.BOMB, bomb, Placeholder.TEAM, member.team().orElseThrow())));
  }

  private List<Candidate> taunters(ChatScene scene) {
    var candidates = new ArrayList<Candidate>();
    for (var member : scene.members()) {
      if (!member.alive() || member.bot().isEmpty() || member.team().isEmpty()) {
        continue;
      }
      var bot = member.bot().orElseThrow();
      var team = member.team().orElseThrow();
      var aimed =
          scene.members().stream()
              .anyMatch(
                  other ->
                      other.alive()
                          && other.team().filter(t -> !t.equals(team)).isPresent()
                          && rival(bot, other));
      candidates.add(
          new Candidate(
              member,
              bot,
              Moment.TAUNT,
              new Chattiness.Context(aimed, false),
              Map.of(Placeholder.TEAM, team)));
    }
    return candidates;
  }

  /** The bot left alone on its team, once per team per match. */
  private List<Candidate> lastAlive(ChatScene scene) {
    var candidates = new ArrayList<Candidate>();
    for (var team : scene.teams()) {
      var alive = scene.alive(team);
      if (alive.size() != 1 || !lastAliveTeams.add(team)) {
        continue;
      }
      var last = alive.getFirst();
      last.bot()
          .ifPresent(
              bot ->
                  candidates.add(
                      new Candidate(
                          last,
                          bot,
                          Moment.ON_LAST_ALIVE,
                          Chattiness.Context.PLAIN,
                          Map.of(Placeholder.TEAM, team))));
    }
    return candidates;
  }

  private static boolean rival(Personality bot, ChatScene.Member other) {
    return other.personalityId().filter(bot.rivals()::contains).isPresent();
  }

  private static ChatScene.Member required(ChatScene scene, UUID uuid) {
    return scene
        .member(uuid)
        .orElseThrow(() -> new IllegalArgumentException("not in the match: " + uuid));
  }

  /**
   * Rolls every candidate that may speak, in order; {@code all} keeps every bot that passes, else
   * one of them at random. Each keeper gets a line and a time under the rate limit.
   */
  private List<Utterance> speak(List<Candidate> candidates, boolean all, Instant now) {
    var passed = new ArrayList<Pick>();
    for (var candidate : candidates) {
      if (!eligible(candidate, now)) {
        continue;
      }
      var open = pickable(candidate);
      if (open.isEmpty()) {
        continue;
      }
      var always = Chattiness.alwaysSpeaks(candidate.bot(), candidate.moment());
      if (!always
          && random.nextDouble()
              >= Chattiness.chance(
                  settings, candidate.bot(), candidate.moment(), candidate.context())) {
        continue;
      }
      passed.add(new Pick(candidate, open.get(random.nextInt(open.size()))));
    }
    if (passed.isEmpty()) {
      return List.of();
    }
    var speakers = all ? passed : List.of(passed.get(random.nextInt(passed.size())));
    var utterances = new ArrayList<Utterance>();
    for (var speaker : speakers) {
      schedule(speaker.candidate(), speaker.line(), now).ifPresent(utterances::add);
    }
    return utterances;
  }

  private boolean eligible(Candidate candidate, Instant now) {
    var member = candidate.member();
    var always = Chattiness.alwaysSpeaks(candidate.bot(), candidate.moment());
    var atEnd = candidate.moment() == Moment.ON_WIN || candidate.moment() == Moment.ON_LOSS;
    if (!atEnd && !member.alive()) {
      var died = diedAt.get(member.uuid());
      if (died == null || now.isAfter(died.plus(settings.recentDeath()))) {
        return false;
      }
    }
    var last = lastSpoke.get(member.uuid());
    return always || last == null || !now.isBefore(last.plus(settings.botCooldown()));
  }

  /** The lines this bot has not said this match and can fill in; ALWAYS_GG narrows to gg lines. */
  private List<String> pickable(Candidate candidate) {
    var used = said.getOrDefault(candidate.member().uuid(), Set.of());
    var open =
        candidate.bot().lines().pool(candidate.moment()).stream()
            .filter(line -> !used.contains(line))
            .filter(line -> candidate.values().keySet().containsAll(Lines.placeholdersOf(line)))
            .toList();
    if (Chattiness.alwaysSpeaks(candidate.bot(), candidate.moment())) {
      var gg = open.stream().filter(line -> GG.matcher(line).find()).toList();
      if (!gg.isEmpty()) {
        return gg;
      }
    }
    return open;
  }

  /** Times the line under the global limit and commits it, or drops it when it would be stale. */
  private Optional<Utterance> schedule(Candidate candidate, String template, Instant now) {
    var at = now.plus(reaction());
    var previous = spoken.peekLast();
    if (previous != null && at.isBefore(previous.plus(settings.minGap()))) {
      at = previous.plus(settings.minGap());
    }
    // Every earlier line comes before this one, so the window ending here has room once the
    // maxLinesPerWindow-th latest line has left it.
    var max = settings.maxLinesPerWindow();
    if (spoken.size() >= max) {
      var freed = new ArrayList<>(spoken).get(spoken.size() - max).plus(settings.window());
      if (at.isBefore(freed)) {
        at = freed;
      }
    }
    if (at.isAfter(now.plus(settings.maxDelay()))) {
      return Optional.empty();
    }
    var member = candidate.member();
    spoken.addLast(at);
    lastSpoke.put(member.uuid(), at);
    said.computeIfAbsent(member.uuid(), uuid -> new HashSet<>()).add(template);
    return Optional.of(
        new Utterance(
            member.uuid(),
            member.name(),
            member.team().orElseThrow(),
            candidate.moment(),
            template,
            fill(template, candidate.values()),
            at));
  }

  /** {@code template} with each placeholder replaced by its value. */
  static String fill(String template, Map<Placeholder, String> values) {
    var text = template;
    for (var placeholder : Lines.placeholdersOf(template)) {
      var value = values.get(placeholder);
      if (value == null) {
        throw new IllegalArgumentException(
            "no value for {" + placeholder.key() + "} in: '" + template + "'");
      }
      text = text.replace("{" + placeholder.key() + "}", value);
    }
    return text;
  }

  private Duration reaction() {
    var min = settings.reactionMin().toMillis();
    var max = settings.reactionMax().toMillis();
    return Duration.ofMillis(min == max ? min : random.nextLong(min, max + 1));
  }

  private Duration tauntWait() {
    return Duration.ofMillis(
        Math.round(settings.tauntEvery().toMillis() * (0.5 + random.nextDouble())));
  }

  /** Forgets say times that no longer count against any window. */
  private void prune(Instant now) {
    var horizon = now.minus(settings.window());
    while (!spoken.isEmpty() && !spoken.peekFirst().isAfter(horizon) && spoken.size() > 1) {
      spoken.removeFirst();
    }
  }
}
