package com.shepherdjerred.thestorm.rwf.testing;

import com.shepherdjerred.thestorm.rwf.app.BotDraftRequest;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * A bot roster over MockBukkit players: every bot is a {@link PlayerMock} that joins the server
 * when spawned and disconnects when despawned, so listeners see it exactly as they would a Citizens
 * NPC.
 */
public final class FakeBotRoster implements BotRoster {

  private final ServerMock server;
  private final Map<CombatantId.Bot, PlayerMock> pending = new LinkedHashMap<>();
  private final Map<CombatantId.Bot, PlayerMock> spawned = new LinkedHashMap<>();
  private final List<CombatantId.Bot> known = new ArrayList<>();
  private int created;
  private int failedSpawnsRemaining;
  private @Nullable RuntimeException spawnException;
  private Optional<BotDraftRequest> lastDraft = Optional.empty();

  public FakeBotRoster(ServerMock server) {
    this.server = server;
  }

  @Override
  public List<CombatantId.Bot> fill(BotDraftRequest request) {
    lastDraft = Optional.of(request);
    var bots = new ArrayList<CombatantId.Bot>();
    for (var i = 0; i < request.slots(); i++) {
      // Like a Citizens NPC, the entity and its UUID exist before it is spawned.
      created++;
      var entity = new PlayerMock(server, "Bot" + created, UUID.randomUUID());
      var bot = new CombatantId.Bot("rusher", entity.getUniqueId());
      pending.put(bot, entity);
      known.add(bot);
      bots.add(bot);
    }
    return bots;
  }

  public Optional<BotDraftRequest> lastDraft() {
    return lastDraft;
  }

  @Override
  public void spawn(CombatantId.Bot id, Location at) {
    if (failedSpawnsRemaining > 0) {
      failedSpawnsRemaining--;
      if (spawnException != null) {
        var failure = spawnException;
        spawnException = null;
        throw failure;
      }
      return;
    }
    var player = pending.remove(id);
    if (player == null) {
      throw new IllegalArgumentException("unknown bot " + id);
    }
    spawned.put(id, player);
    server.addPlayer(player);
    player.teleport(at);
  }

  @Override
  public Player move(CombatantId.Bot id, Location to) {
    var player = entity(id).orElseThrow();
    player.teleport(to);
    return player;
  }

  @Override
  public void despawn(CombatantId.Bot id) {
    pending.remove(id);
    var player = spawned.remove(id);
    if (player != null && player.isOnline()) {
      player.disconnect();
    }
  }

  @Override
  public Optional<Player> entity(CombatantId.Bot id) {
    return Optional.ofNullable(spawned.get(id)).filter(PlayerMock::isOnline).map(p -> p);
  }

  @Override
  public boolean isBot(UUID entity) {
    return spawned.values().stream().anyMatch(player -> player.getUniqueId().equals(entity));
  }

  /** The bots in the world now. */
  public List<PlayerMock> spawned() {
    return List.copyOf(spawned.values());
  }

  /** Bots drafted but neither spawned nor released yet. */
  public int drafted() {
    return pending.size();
  }

  /** Leaves the next drafted body without an entity, as a failed Citizens spawn does. */
  public void failNextSpawns(int count) {
    failedSpawnsRemaining = count;
  }

  /** Throws the production adapter's refusal instead of producing an entity. */
  public void throwOnNextSpawn(RuntimeException failure) {
    failedSpawnsRemaining = 1;
    spawnException = failure;
  }

  /** Every bot ever handed out. */
  public List<CombatantId.Bot> known() {
    return List.copyOf(known);
  }

  public Optional<CombatantId.Bot> idOf(Player player) {
    return spawned.entrySet().stream()
        .filter(entry -> entry.getValue().getUniqueId().equals(player.getUniqueId()))
        .map(Map.Entry::getKey)
        .findFirst();
  }
}
