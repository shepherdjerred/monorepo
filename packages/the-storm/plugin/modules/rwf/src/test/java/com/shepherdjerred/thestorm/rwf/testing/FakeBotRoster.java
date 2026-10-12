package com.shepherdjerred.thestorm.rwf.testing;

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

  public FakeBotRoster(ServerMock server) {
    this.server = server;
  }

  @Override
  public List<CombatantId.Bot> fill(UUID matchId, int slots) {
    var bots = new ArrayList<CombatantId.Bot>();
    for (var i = 0; i < slots; i++) {
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

  @Override
  public void spawn(CombatantId.Bot id, Location at) {
    var player = pending.remove(id);
    if (player == null) {
      throw new IllegalArgumentException("unknown bot " + id);
    }
    spawned.put(id, player);
    server.addPlayer(player);
    player.teleport(at);
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
