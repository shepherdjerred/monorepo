package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The small stable numbers the bots' world uses for one match, assigned in order of first sight:
 * entity UUIDs become {@link CombatantId}s and rwf bomb ids become {@link BombId}s. Teams keep
 * rwf's lower-case colour names. Main thread only.
 */
public final class IdMap {

  private final Map<UUID, CombatantId> combatants = new HashMap<>();
  private final Map<CombatantId, UUID> uuids = new HashMap<>();
  private final Map<String, BombId> bombs = new HashMap<>();
  private final Map<BombId, String> bombNames = new HashMap<>();

  public CombatantId combatant(UUID uuid) {
    var existing = combatants.get(uuid);
    if (existing != null) {
      return existing;
    }
    var id = new CombatantId(combatants.size());
    combatants.put(uuid, id);
    uuids.put(id, uuid);
    return id;
  }

  public Optional<UUID> uuid(CombatantId id) {
    return Optional.ofNullable(uuids.get(id));
  }

  public Optional<CombatantId> known(UUID uuid) {
    return Optional.ofNullable(combatants.get(uuid));
  }

  public BombId bomb(String rwfBombId) {
    var existing = bombs.get(rwfBombId);
    if (existing != null) {
      return existing;
    }
    var id = new BombId(bombs.size());
    bombs.put(rwfBombId, id);
    bombNames.put(id, rwfBombId);
    return id;
  }

  public Optional<String> bombName(BombId id) {
    return Optional.ofNullable(bombNames.get(id));
  }

  public static TeamId team(String rwfTeam) {
    return new TeamId(rwfTeam);
  }
}
