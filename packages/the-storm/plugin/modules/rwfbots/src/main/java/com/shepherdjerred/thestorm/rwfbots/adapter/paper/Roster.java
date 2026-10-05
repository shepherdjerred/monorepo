package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.BotBodies;
import com.shepherdjerred.thestorm.rwf.app.BotHandle;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.app.Governor;
import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.app.StatsCache;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The bots rwf asks for: {@code fill} runs the director against the personality catalog, the stored
 * ratings and the humans in the lobby, excluding any personality whose name an online human is
 * using, and refuses outright when the chosen map has no current nav artifact. Spawning and
 * despawning go to the {@link Bodies}. The roster also owns each bot's {@link BotBody} and the live
 * {@link MatchSession}. Main thread only.
 */
public final class Roster implements BotBodies {

  private final Parts parts;
  private final Map<UUID, BotBody> bots = new LinkedHashMap<>();
  private @Nullable MatchSession session;

  /**
   * What the roster works from.
   *
   * @param server the server, for online human names
   * @param view rwf's read model
   * @param bodies the bodies
   * @param personalities the catalog
   * @param stats the cached records
   * @param nav the nav artifacts
   * @param governor whose level may shrink the draft
   * @param config the module settings
   * @param random the module's randomness
   * @param logger the module logger
   */
  public record Parts(
      Server server,
      MatchView view,
      Bodies bodies,
      PersonalityCatalog personalities,
      StatsCache stats,
      NavCatalog nav,
      Governor governor,
      RwfBotsConfig config,
      RandomGenerator random,
      ComponentLogger logger) {}

  public Roster(Parts parts) {
    this.parts = parts;
  }

  public Bodies bodies() {
    return parts.bodies();
  }

  // ---- the rwf contract ------------------------------------------------------------------------

  @Override
  public List<BotHandle> fill(UUID matchId, int slots) {
    var state = parts.view().current().map(MatchState::of);
    var mapId = state.flatMap(MatchState::mapId);
    if (mapId.isEmpty()) {
      parts.logger().error("rwfbots: asked to fill match {} before a map was chosen", matchId);
      return List.of();
    }
    if (parts.nav().forMap(mapId.orElseThrow()).isEmpty()) {
      parts
          .logger()
          .error(
              "rwfbots: map {} has no usable nav artifact ({}); the match runs humans-only",
              mapId.orElseThrow(),
              parts.nav().problems().getOrDefault(mapId.orElseThrow(), "not confirmed yet"));
      return List.of();
    }
    var wanted = Math.max(0, slots - parts.governor().draftReduction());
    var humans = state.orElseThrow().combatants().stream().filter(f -> !f.bot()).count();
    var request =
        new Director.Request(
            parts.personalities(),
            parts.stats().ratings(),
            Collections.nCopies((int) humans, Rating.DEFAULT),
            wanted,
            onlineNames(),
            parts.config().draft().availableKits(),
            Math.max(2, state.orElseThrow().teams().size()));
    var pick = Director.pick(request, parts.random());
    var handles = new ArrayList<BotHandle>();
    // rwf walks bots into the lobby in this order: the ones always late come last.
    var order =
        pick.bots().stream()
            .sorted(
                Comparator.comparing(
                    (Director.Drafted drafted) ->
                        drafted.personality().quirks().contains(Quirk.LATE_TO_EVERYTHING)))
            .toList();
    for (var drafted : order) {
      var uuid = parts.bodies().create(drafted.personality());
      bots.put(uuid, new BotBody(uuid, drafted));
      handles.add(new BotHandle(drafted.personality().id(), uuid));
    }
    parts
        .logger()
        .info(
            "rwfbots: drafted {} of {} bots for match {} (shift {})",
            handles.size(),
            slots,
            matchId,
            Math.round(pick.shift() * 100) / 100.0);
    return handles;
  }

  private Set<String> onlineNames() {
    var names = new HashSet<String>();
    for (var player : parts.server().getOnlinePlayers()) {
      if (!parts.bodies().isBot(player.getUniqueId())) {
        names.add(player.getName());
      }
    }
    return names;
  }

  @Override
  public void spawn(BotHandle bot, Location at) {
    if (!bots.containsKey(bot.uuid())) {
      throw new IllegalArgumentException("unknown bot " + bot);
    }
    parts.bodies().spawn(bot.uuid(), at);
  }

  @Override
  public void despawn(BotHandle bot) {
    var body = bots.remove(bot.uuid());
    if (body != null) {
      body.leaveMatch();
    }
    parts.bodies().despawn(bot.uuid());
  }

  @Override
  public Optional<Player> entity(BotHandle bot) {
    return parts.bodies().entity(bot.uuid());
  }

  @Override
  public boolean isBot(UUID entity) {
    return parts.bodies().isBot(entity);
  }

  // ---- the bots' side --------------------------------------------------------------------------

  public Optional<BotBody> bot(UUID uuid) {
    return Optional.ofNullable(bots.get(uuid));
  }

  /** Every bot drafted and not yet despawned, in draft order. */
  public List<BotBody> live() {
    return List.copyOf(bots.values());
  }

  public Optional<MatchSession> session() {
    return Optional.ofNullable(session);
  }

  void session(@Nullable MatchSession next) {
    session = next;
  }

  /** Whether {@code id} in the current session is a human. */
  public boolean isHuman(CombatantId id) {
    var current = session;
    if (current == null) {
      return false;
    }
    return current.ids().uuid(id).map(uuid -> !parts.bodies().isBot(uuid)).orElse(false);
  }

  /** The entity of any combatant: bots through their bodies, humans through the server. */
  public Optional<Player> anyEntity(UUID uuid) {
    if (parts.bodies().isBot(uuid)) {
      return parts.bodies().entity(uuid);
    }
    return Optional.ofNullable(parts.server().getPlayer(uuid));
  }

  /** Forgets every bot and despawns every body. */
  public void clear() {
    bots.clear();
    session = null;
    parts.bodies().despawnAll();
  }
}
