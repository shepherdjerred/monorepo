package com.shepherdjerred.thestorm.world.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.world.domain.MerchantAnchor;
import com.shepherdjerred.thestorm.world.domain.MerchantConfig;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.WanderingTrader;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class WindmillMerchantTest {

  private ServerMock server;
  private WorldMock world;
  private WorldMock wilds;
  private PlayerMock player;
  private Plugin plugin;
  private MerchantAnchor anchor;
  private MerchantConfig config;
  private WindmillMerchant merchant;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    wilds = server.addSimpleWorld("wilds");
    player = server.addPlayer();
    plugin = MockBukkit.createMockPlugin();
    var spawn = world.getSpawnLocation();
    anchor =
        new MerchantAnchor(
            spawn.getBlockX(),
            Math.max(spawn.getBlockY(), world.getMinHeight() + 2),
            spawn.getBlockZ());
    config = new MerchantConfig(true, "world", List.of(anchor), 12, 20, "America/Los_Angeles");
    world.loadChunk(anchor.x() >> 4, anchor.z() >> 4);
    world.getBlockAt(anchor.x(), anchor.y() - 1, anchor.z()).setType(Material.STONE);
    world.getBlockAt(anchor.x(), anchor.y(), anchor.z()).setType(Material.AIR);
    world.getBlockAt(anchor.x(), anchor.y() + 1, anchor.z()).setType(Material.AIR);
    merchant = onDate("2026-09-27T18:30:00Z");
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void nearbyArrivalStartsOneFiniteItemBarterVisitPerPacificDate() {
    player.teleport(place());
    merchant.onJoin(new PlayerJoinEvent(player, Component.empty()));

    var trader = onlyTrader();
    assertThat(trader.getDespawnDelay()).isEqualTo(20 * 60 * 20);
    assertThat(trader.isInvulnerable()).isTrue();
    assertThat(trader.getRecipes()).hasSize(2);
    assertThat(trader.getRecipes())
        .allSatisfy(
            recipe -> {
              assertThat(recipe.getIngredients()).hasSize(1);
              assertThat(recipe.getMaxUses()).isBetween(4, 8);
              assertThat(recipe.getPriceMultiplier()).isZero();
              assertThat(recipe.shouldIgnoreDiscounts()).isTrue();
            });

    trader.remove();
    merchant.onMove(new PlayerMoveEvent(player, place(), place().clone().add(1, 0, 0)));
    assertThat(traders()).isEmpty();

    onDate("2026-09-28T18:30:00Z").onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(traders()).hasSize(1);
  }

  @Test
  void otherWorldAndUnsafeAnchorDoNotSpawnTrader() {
    player.teleport(wilds.getSpawnLocation());
    merchant.onJoin(new PlayerJoinEvent(player, Component.empty()));
    merchant.onWorldChange(new PlayerChangedWorldEvent(player, world));
    assertThat(traders()).isEmpty();

    player.teleport(place());
    world.getBlockAt(anchor.x(), anchor.y() - 1, anchor.z()).setType(Material.AIR);
    merchant.onJoin(new PlayerJoinEvent(player, Component.empty()));
    assertThat(traders()).isEmpty();
  }

  @Test
  void corruptWorldVisitMarkerFailsInsteadOfResetting() {
    player.teleport(place());
    world
        .getPersistentDataContainer()
        .set(
            new NamespacedKey(plugin, "windmill_merchant_visit_day"),
            PersistentDataType.STRING,
            "invalid");

    assertThatThrownBy(() -> merchant.onJoin(new PlayerJoinEvent(player, Component.empty())))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("invalid merchant visit day");
  }

  private WindmillMerchant onDate(String at) {
    return new WindmillMerchant(
        plugin,
        config,
        new WindmillMerchant.Services(
            InstantSource.fixed(Instant.parse(at)),
            ComponentLogger.logger("windmill-merchant-test"),
            playerId -> java.util.concurrent.CompletableFuture.completedFuture(true),
            Runnable::run));
  }

  private Location place() {
    return new Location(world, anchor.x() + 0.5, anchor.y(), anchor.z() + 0.5);
  }

  private WanderingTrader onlyTrader() {
    assertThat(traders()).hasSize(1);
    return traders().getFirst();
  }

  private List<WanderingTrader> traders() {
    return world.getEntities().stream()
        .filter(WanderingTrader.class::isInstance)
        .map(WanderingTrader.class::cast)
        .toList();
  }
}
