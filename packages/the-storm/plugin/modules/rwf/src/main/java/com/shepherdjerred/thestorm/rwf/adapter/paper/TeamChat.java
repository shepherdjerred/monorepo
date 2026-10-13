// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameManager.java, onChat, and
// redwarfare-arcade/src/me/libraryaddict/arcade/commands/CommandTeamChat.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChannelRegistry;
import com.shepherdjerred.thestorm.chat.app.ChannelRouter;
import com.shepherdjerred.thestorm.chat.app.ChatChannel;
import com.shepherdjerred.thestorm.chat.app.ChatTap;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import org.bukkit.entity.Player;

/**
 * Team chat and dead chat, through the chat module, as Red Warfare had them: once teams are dealt a
 * living member's plain chat goes to their team when auto team chat is on (the default), and a
 * leading {@code @} sends the other way; {@code /t} and {@code /g} name the channel outright. The
 * dead and the watchers talk among themselves, so the living never hear them. {@code /rwf teamchat}
 * toggles auto team chat and is kept with the player's preferences. Every line is handed to the
 * recording (bots' in full, humans' as channel and length only).
 *
 * <p>The chat module asks from its async threads, so who is on which team is kept as an immutable
 * view the main thread replaces after every change.
 */
final class TeamChat {

  /**
   * Who hears what, as of the last change.
   *
   * @param on whether team chat is on for this match
   * @param teams each living or dead member's team, by entity UUID
   * @param alive the members still fighting
   * @param dead the dead members and the watchers
   */
  private record View(boolean on, Map<UUID, TeamColor> teams, Set<UUID> alive, Set<UUID> dead) {

    static final View OFF = new View(false, Map.of(), Set.of(), Set.of());
  }

  private final MatchRunner runner;
  private final Watchers watchers;
  private final StatsStore stats;
  private final PaperContext context;
  private final Consumer<ChatTap.Heard> recorder;
  private final Map<UUID, Boolean> autoTeam = new ConcurrentHashMap<>();
  private final List<Subscription> subscriptions = new ArrayList<>();
  private volatile View view = View.OFF;

  /**
   * What team chat works with.
   *
   * @param runner the match
   * @param watchers the players watching it
   * @param stats where the auto team chat preference is kept
   * @param context the shared server services
   * @param recorder hears every line on the main thread, for the recording
   */
  record Parts(
      MatchRunner runner,
      Watchers watchers,
      StatsStore stats,
      PaperContext context,
      Consumer<ChatTap.Heard> recorder) {}

  TeamChat(Parts parts) {
    this.runner = parts.runner();
    this.watchers = parts.watchers();
    this.stats = parts.stats();
    this.context = parts.context();
    this.recorder = parts.recorder();
  }

  /** Plugs into chat, when the chat module is on. */
  void register(Optional<ChannelRegistry> registry) {
    registry.ifPresent(
        chat -> {
          subscriptions.add(chat.registerMembership(ChatChannel.TEAM, this::team));
          subscriptions.add(chat.registerMembership(ChatChannel.DEAD, this::dead));
          subscriptions.add(chat.registerRouter(this::route));
          subscriptions.add(chat.registerTap(this::heard));
        });
  }

  void unregister() {
    subscriptions.forEach(Subscription::cancel);
    subscriptions.clear();
    view = View.OFF;
  }

  /** Rebuilds who hears what; main thread, after every match change. */
  void refresh() {
    var snapshot = runner.current();
    if (snapshot.isEmpty() || !runner.features().teamChat() || !runner.match().phase().started()) {
      view = new View(runner.features().teamChat(), Map.of(), Set.of(), Set.of());
      return;
    }
    var teams = new HashMap<UUID, TeamColor>();
    var alive = new HashSet<UUID>();
    var dead = new HashSet<>(watchersOnline());
    for (var combatant : snapshot.orElseThrow().combatants()) {
      var id = combatant.id().uuid();
      combatant.team().ifPresent(team -> teams.put(id, team));
      if (combatant.alive()) {
        alive.add(id);
      } else {
        dead.add(id);
      }
    }
    view = new View(true, Map.copyOf(teams), Set.copyOf(alive), Set.copyOf(dead));
  }

  private Set<UUID> watchersOnline() {
    var out = new HashSet<UUID>();
    for (var player : context.server().getOnlinePlayers()) {
      if (watchers.watching(player.getUniqueId())) {
        out.add(player.getUniqueId());
      }
    }
    return out;
  }

  /** The speaker's living teammates and themselves, while they fight. */
  private Optional<Set<UUID>> team(UUID speaker) {
    var current = view;
    var team = current.teams().get(speaker);
    if (!current.on() || team == null || !current.alive().contains(speaker)) {
      return Optional.empty();
    }
    var out = new HashSet<UUID>();
    current
        .teams()
        .forEach(
            (id, color) -> {
              if (color == team && current.alive().contains(id)) {
                out.add(id);
              }
            });
    return Optional.of(Set.copyOf(out));
  }

  /** The dead and the watchers, when the speaker is one of them. */
  private Optional<Set<UUID>> dead(UUID speaker) {
    var current = view;
    return current.on() && current.dead().contains(speaker)
        ? Optional.of(current.dead())
        : Optional.empty();
  }

  /**
   * Red Warfare's routing: the dead and watchers' Global goes to the dead; a fighter's plain chat
   * goes to their team when auto team chat is on, and a leading {@code @} flips it.
   */
  private Optional<ChannelRouter.Routed> route(ChannelRouter.Request request) {
    var current = view;
    if (!current.on() || request.chosen() != ChatChannel.GLOBAL) {
      return Optional.empty();
    }
    var speaker = request.speaker();
    var text = request.text();
    if (current.dead().contains(speaker)) {
      return Optional.of(new ChannelRouter.Routed(ChatChannel.DEAD, strip(text)));
    }
    if (request.command() || !current.alive().contains(speaker)) {
      return Optional.empty();
    }
    var flipped = text.startsWith("@");
    var toTeam = autoTeam.getOrDefault(speaker, true) != flipped;
    var said = strip(text);
    if (said.isBlank()) {
      return Optional.empty();
    }
    return Optional.of(
        new ChannelRouter.Routed(toTeam ? ChatChannel.TEAM : ChatChannel.GLOBAL, said));
  }

  private static String strip(String text) {
    return text.startsWith("@") ? text.substring(1).stripLeading() : text;
  }

  private void heard(ChatTap.Heard line) {
    if (!view.on()) {
      return;
    }
    context.scheduler().runOnMainThread(() -> recorder.accept(line));
  }

  /** A human entered the match: their auto team chat preference is read. */
  void entered(UUID player) {
    context.onMain(
        stats.prefs(player),
        prefs -> autoTeam.put(player, prefs.teamChat()),
        "read the rwf chat preference of " + player);
  }

  /** {@code /rwf teamchat}: auto team chat flips and is kept. */
  void toggle(Player player) {
    if (!runner.features().teamChat()) {
      Texts.error(player, "Team chat is not open yet.");
      return;
    }
    var id = player.getUniqueId();
    var on = !autoTeam.getOrDefault(id, true);
    autoTeam.put(id, on);
    context.logFailure(stats.teamChat(id, on), "save the rwf chat preference of " + id);
    Texts.info(
        player,
        on
            ? "Your chat now goes to your team during a match; start with @ to talk to everyone."
            : "Your chat now goes to everyone; start with @ to talk to your team.");
  }

  /** The player left the server: their cached preference goes. */
  void forget(UUID player) {
    autoTeam.remove(player);
  }

  /** For tests: whether {@code speaker}'s plain line would reach the team. */
  boolean wouldReachTeam(UUID speaker, String text) {
    return route(new ChannelRouter.Request(speaker, ChatChannel.GLOBAL, text, false))
        .filter(routed -> routed.channel() == ChatChannel.TEAM)
        .isPresent();
  }
}
