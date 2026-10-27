package com.shepherdjerred.thestorm.towns.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageIndex;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.util.List;
import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityExhaustionEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/** Hunger, Speed II and Jump Boost I on the 2015 and 2016 archive spawn sites. */
final class SpawnComfortTest {

  private ServerMock server;
  private World world;
  private World map2;
  private Player player;
  private SpawnComfort comfort;
  private Location spawn;
  private Location colosseum;
  private Location wild;
  private Location map2Spawn;
  private Location map2Wild;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    map2 = server.addSimpleWorld("map2");
    player = server.addPlayer("Alice");
    var state = new TownsState(new RegionIndex(List.of()));
    state.attachHeritage(
        new HeritageIndex(
            List.of(
                site("spawn", "world", 0, 31),
                site("colosseum", "world", 32, 47),
                site("map2-spawn", "map2", 0, 31))));
    comfort = new SpawnComfort(state, Set.of("spawn", "map2-spawn"));
    spawn = at(world, 8);
    colosseum = at(world, 40);
    wild = at(world, 80);
    map2Spawn = at(map2, 8);
    map2Wild = at(map2, 80);
    player.teleport(wild);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void bothSpawnSitesFillHungerAndGrantSpeedAndJump() {
    hungry();
    move(wild, spawn);

    assertComfort();
    player.setSaturation(0);
    player.setExhaustion(4);
    var sprint =
        new EntityExhaustionEvent(player, EntityExhaustionEvent.ExhaustionReason.SPRINT, 4);
    comfort.onExhaustion(sprint);
    assertThat(sprint.isCancelled()).isTrue();
    assertThat(player.getSaturation()).isEqualTo(20f);
    assertThat(player.getExhaustion()).isZero();
    player.setSaturation(0);
    var drop = new FoodLevelChangeEvent(player, 10, ItemStack.empty());
    comfort.onFood(drop);
    assertThat(drop.getFoodLevel()).isEqualTo(20);
    assertThat(player.getSaturation()).isEqualTo(20f);

    move(spawn, colosseum);
    assertThat(player.getFoodLevel()).isEqualTo(20);
    assertNoSpawnEffects();
    player.setSaturation(0);
    var outside = new FoodLevelChangeEvent(player, 10, ItemStack.empty());
    var walked = new EntityExhaustionEvent(player, EntityExhaustionEvent.ExhaustionReason.WALK, 1);
    comfort.onFood(outside);
    comfort.onExhaustion(walked);
    assertThat(outside.getFoodLevel()).isEqualTo(10);
    assertThat(outside.isCancelled()).isFalse();
    assertThat(walked.isCancelled()).isFalse();
    assertThat(player.getSaturation()).isZero();

    hungry();
    teleport(colosseum, map2Spawn);
    assertComfort();
    player.setSaturation(1);
    var mapDrop = new FoodLevelChangeEvent(player, 5, ItemStack.empty());
    comfort.onFood(mapDrop);
    assertThat(mapDrop.getFoodLevel()).isEqualTo(20);
    assertThat(player.getSaturation()).isEqualTo(20f);

    move(map2Spawn, map2Wild);
    assertThat(player.getFoodLevel()).isEqualTo(20);
    assertNoSpawnEffects();
  }

  @Test
  void joiningOrRespawningInsideSpawnGrantsComfort() {
    player.teleport(spawn);
    hungry();
    comfort.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertComfort();

    clearEffects();
    hungry();
    var respawn =
        new PlayerRespawnEvent(
            player, map2Spawn, false, false, false, PlayerRespawnEvent.RespawnReason.DEATH);
    player.teleport(map2Spawn);
    comfort.onRespawn(respawn);
    assertComfort();
  }

  @Test
  void aDrunkSpeedPotionIsLeftInPlace() {
    player.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 200, 1, false, true, true));
    hungry();
    move(wild, spawn);

    var speed = requireNonNull(player.getPotionEffect(PotionEffectType.SPEED));
    assertThat(speed.isInfinite()).isFalse();
    assertThat(speed.hasParticles()).isTrue();
    assertThat(speed.getDuration()).isEqualTo(200);
    assertThat(player.getFoodLevel()).isEqualTo(20);
    var jump = requireNonNull(player.getPotionEffect(PotionEffectType.JUMP_BOOST));
    assertThat(jump.isInfinite()).isTrue();
    assertThat(jump.getAmplifier()).isZero();

    move(spawn, wild);
    speed = requireNonNull(player.getPotionEffect(PotionEffectType.SPEED));
    assertThat(speed.getDuration()).isEqualTo(200);
    assertThat(speed.hasParticles()).isTrue();
    assertThat(player.hasPotionEffect(PotionEffectType.JUMP_BOOST)).isFalse();
  }

  private void move(Location from, Location to) {
    player.teleport(to);
    comfort.onMove(new PlayerMoveEvent(player, from, to));
  }

  private void teleport(Location from, Location to) {
    player.teleport(to);
    comfort.onTeleport(new PlayerTeleportEvent(player, from, to));
  }

  private void hungry() {
    player.setFoodLevel(6);
    player.setSaturation(0);
    player.setExhaustion(3);
  }

  private void clearEffects() {
    player.removePotionEffect(PotionEffectType.SPEED);
    player.removePotionEffect(PotionEffectType.JUMP_BOOST);
  }

  private void assertComfort() {
    assertThat(player.getFoodLevel()).isEqualTo(20);
    assertThat(player.getSaturation()).isEqualTo(20f);
    assertThat(player.getExhaustion()).isZero();
    var speed = requireNonNull(player.getPotionEffect(PotionEffectType.SPEED));
    assertThat(speed.isInfinite()).isTrue();
    assertThat(speed.getAmplifier()).isEqualTo(1);
    assertThat(speed.hasParticles()).isFalse();
    assertThat(speed.hasIcon()).isTrue();
    var jump = requireNonNull(player.getPotionEffect(PotionEffectType.JUMP_BOOST));
    assertThat(jump.isInfinite()).isTrue();
    assertThat(jump.getAmplifier()).isZero();
    assertThat(jump.hasParticles()).isFalse();
    assertThat(jump.hasIcon()).isTrue();
  }

  private void assertNoSpawnEffects() {
    assertThat(player.hasPotionEffect(PotionEffectType.SPEED)).isFalse();
    assertThat(player.hasPotionEffect(PotionEffectType.JUMP_BOOST)).isFalse();
  }

  private static Location at(World world, int x) {
    return new Location(world, x + 0.5, 64, 8.5);
  }

  private static HeritageSite site(String id, String world, int fromX, int toX) {
    return new HeritageSite(
        id,
        id + " name",
        HeritageSite.Kind.SERVER,
        "",
        world,
        RegionProfile.SAFE,
        Set.of(),
        List.of(new Cuboid(world, new BlockCorner(fromX, -64, 0), new BlockCorner(toX, 319, 31))),
        Set.of(),
        List.of(),
        "Fixture provenance.");
  }
}
