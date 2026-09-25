package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.Victim;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Block and entity classification, from vanilla tags and entity types. */
final class KindsTest {

  private ServerMock server;
  private WorldMock world;
  private BlockKinds kinds;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    kinds = new BlockKinds();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void rightClickingBlocks() {
    assertThat(kinds.use(Material.OAK_DOOR)).contains(new Act(Action.INTERACT, Subject.DOOR));
    assertThat(kinds.use(Material.COPPER_DOOR)).contains(new Act(Action.INTERACT, Subject.DOOR));
    assertThat(kinds.use(Material.BIRCH_TRAPDOOR))
        .contains(new Act(Action.INTERACT, Subject.TRAPDOOR));
    assertThat(kinds.use(Material.STONE_BUTTON)).contains(new Act(Action.INTERACT, Subject.BUTTON));
    assertThat(kinds.use(Material.LEVER)).contains(new Act(Action.INTERACT, Subject.LEVER));
    assertThat(kinds.use(Material.RED_BED)).contains(new Act(Action.INTERACT, Subject.BED));
    assertThat(kinds.use(Material.RESPAWN_ANCHOR))
        .contains(new Act(Action.INTERACT, Subject.RESPAWN_ANCHOR));
    for (var container :
        new Material[] {
          Material.CHEST,
          Material.BARREL,
          Material.SHULKER_BOX,
          Material.COPPER_CHEST,
          Material.OAK_SHELF,
          Material.CHISELED_BOOKSHELF,
          Material.DECORATED_POT,
          Material.VAULT,
          Material.CRAFTER,
          Material.CAMPFIRE,
        }) {
      assertThat(kinds.use(container))
          .as("%s", container)
          .contains(new Act(Action.OPEN_CONTAINER, Subject.CONTAINER));
    }
    assertThat(kinds.use(Material.REPEATER))
        .contains(new Act(Action.USE_REDSTONE, Subject.REDSTONE_COMPONENT));
    assertThat(kinds.use(Material.CAKE)).contains(new Act(Action.BREAK, Subject.CAKE));
    assertThat(kinds.use(Material.CRAFTING_TABLE)).isEmpty();
    assertThat(kinds.use(Material.ENDER_CHEST)).isEmpty();
    assertThat(kinds.use(Material.STONE)).isEmpty();
  }

  @Test
  void steppingAndProjectiles() {
    assertThat(kinds.step(Material.FARMLAND)).contains(new Act(Action.BREAK, Subject.FARMLAND));
    assertThat(kinds.step(Material.OAK_PRESSURE_PLATE))
        .contains(new Act(Action.INTERACT, Subject.PRESSURE_PLATE));
    assertThat(kinds.step(Material.STONE)).isEmpty();
    assertThat(kinds.impact(Material.TARGET))
        .contains(new Act(Action.USE_REDSTONE, Subject.REDSTONE_COMPONENT));
    assertThat(kinds.impact(Material.DECORATED_POT)).contains(new Act(Action.BREAK, Subject.BLOCK));
    assertThat(kinds.impact(Material.OAK_BUTTON))
        .contains(new Act(Action.INTERACT, Subject.BUTTON));
    assertThat(kinds.impact(Material.STONE)).isEmpty();
  }

  @Test
  void subjectsAndTools() {
    assertThat(kinds.subject(Material.OAK_SIGN)).isEqualTo(Subject.SIGN);
    assertThat(kinds.subject(Material.STONE)).isEqualTo(Subject.BLOCK);
    assertThat(kinds.opensWithRedstone(Material.SPRUCE_FENCE_GATE)).isTrue();
    assertThat(kinds.opensWithRedstone(Material.LEVER)).isFalse();
    assertThat(kinds.changesBlocks(Material.IRON_AXE)).isTrue();
    assertThat(kinds.changesBlocks(Material.WOODEN_HOE)).isTrue();
    assertThat(kinds.changesBlocks(Material.HONEYCOMB)).isTrue();
    assertThat(kinds.changesBlocks(Material.BRUSH)).isTrue();
    assertThat(kinds.changesBlocks(Material.ZOMBIE_SPAWN_EGG)).isTrue();
    assertThat(kinds.changesBlocks(Material.RED_DYE)).isTrue();
    assertThat(kinds.changesBlocks(Material.BREAD)).isFalse();
    assertThat(kinds.changesBlocks(Material.DIAMOND_SWORD)).isFalse();
  }

  @Test
  void entities() {
    var at = new Location(world, 0, 64, 0);
    var cow = world.spawnEntity(at, EntityType.COW);
    var zombie = world.spawnEntity(at, EntityType.ZOMBIE);
    var villager = world.spawnEntity(at, EntityType.VILLAGER);
    var stand = world.spawnEntity(at, EntityType.ARMOR_STAND);
    var player = server.addPlayer("Alice");

    assertThat(EntityKinds.subject(cow)).contains(Subject.ANIMAL);
    assertThat(EntityKinds.subject(zombie)).isEmpty();
    assertThat(EntityKinds.subject(villager)).contains(Subject.VILLAGER);
    assertThat(EntityKinds.subject(stand)).contains(Subject.ARMOR_STAND);
    assertThat(EntityKinds.subject(player)).isEmpty();
    var someone = UUID.randomUUID();
    assertThat(EntityKinds.victim(cow, someone)).isEqualTo(new Victim.Protected(Subject.ANIMAL));
    assertThat(EntityKinds.victim(zombie, someone)).isEqualTo(new Victim.Unprotected());
    assertThat(EntityKinds.victim(player, someone)).isEqualTo(new Victim.OtherPlayer());
    assertThat(EntityKinds.victim(player, player.getUniqueId())).isEqualTo(new Victim.Self());
  }
}
