package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.util.List;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.EntityType;
import org.bukkit.persistence.PersistentDataType;
import org.junit.jupiter.api.Test;

final class HeritageCombatTest extends AegisServer {
  private Land land(RegionProfile profile) {
    var site =
        new HeritageSite(
            "colosseum",
            "Arena",
            HeritageSite.Kind.SERVER,
            "",
            "world",
            profile,
            Set.of(),
            List.of(
                new Cuboid(
                    "world", new BlockCorner(500, -64, 500), new BlockCorner(599, 319, 599))),
            Set.of(),
            List.of(),
            "Disposable test footprint");
    return new Land.HeritageLand(site, Set.of(), new Land.Wilderness());
  }

  @Test
  void onlyMatchingTemporaryArenaEntitiesReceiveTheGameCombatExemption() {
    var sheep = world.spawnEntity(new Location(world, 540, Y, 540), EntityType.SHEEP);
    var arena = land(RegionProfile.ARENA);
    var tag = new NamespacedKey("thestorm", "arena_entity");
    assertThat(CombatListener.isArenaEntity(sheep, arena)).isFalse();
    sheep.getPersistentDataContainer().set(tag, PersistentDataType.STRING, "settlement");
    assertThat(CombatListener.isArenaEntity(sheep, arena)).isFalse();
    sheep.getPersistentDataContainer().set(tag, PersistentDataType.STRING, "colosseum");
    assertThat(CombatListener.isArenaEntity(sheep, arena)).isTrue();
    assertThat(CombatListener.isArenaEntity(sheep, land(RegionProfile.SAFE))).isFalse();
    assertThat(CombatListener.isArenaEntity(sheep, new Land.Wilderness())).isFalse();
    bob.getPersistentDataContainer().set(tag, PersistentDataType.STRING, "colosseum");
    assertThat(CombatListener.isArenaEntity(bob, arena)).isFalse();
  }
}
