package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import java.lang.reflect.Proxy;
import java.util.Random;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class RwfWorldsPaperTest {

  private static final RwfConfig.Worlds CONFIG =
      new RwfConfig.Worlds("rwf_lobby", "rwf", RwfConfig.LobbyProvisioning.OWNED_VOID);

  private final SealedWorlds sealed = new SealedWorlds();
  private ServerMock server;
  private ProvisioningServer lifecycle;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    lifecycle = new ProvisioningServer();
    server.addSimpleWorld("rwf");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void createsTheDeclaredVoidLobbyAfterSealingItsName() {
    var lobby = RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42));

    assertThat(lobby.getName()).isEqualTo("rwf_lobby");
    assertThat(lobby.getKey()).isEqualTo(NamespacedKey.minecraft("rwf_lobby"));
    assertThat(lobby.getEnvironment()).isEqualTo(World.Environment.NORMAL);
    assertThat(sealed.isSealed(lobby)).isTrue();
    var creator = requireNonNull(lifecycle.creator);
    assertThat(creator.type()).isEqualTo(WorldType.FLAT);
    assertThat(creator.generateStructures()).isFalse();
    assertThat(creator.generatorSettings())
        .isEqualTo(
            "{\"layers\":[{\"block\":\"minecraft:air\",\"height\":1}],\"biome\":\"minecraft:the_void\"}");
    assertThat(creator.seed()).isEqualTo(new Random(42).nextLong());
  }

  @Test
  void reusesAnExistingLobbyAndRetainsItsIdentityAndTerrain() {
    var existing = server.createWorld(WorldCreator.ofKey(NamespacedKey.minecraft("rwf_lobby")));
    var identity = existing.getUID();
    existing.getBlockAt(256, 64, 256).setType(Material.DIAMOND_BLOCK);
    lifecycle.tickingWorlds = true;

    var lobby = RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42));
    var restarted = RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(43));

    assertThat(lobby).isSameAs(existing);
    assertThat(restarted.getUID()).isEqualTo(identity);
    assertThat(restarted.getBlockAt(256, 64, 256).getType()).isEqualTo(Material.DIAMOND_BLOCK);
    assertThat(lifecycle.creator).isNull();
  }

  @Test
  void rejectsPreparationOffThePrimaryThreadBeforeSealingOrCreating() {
    lifecycle.primaryThread = false;

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("primary server thread");
    assertThat(server.getWorld("rwf_lobby")).isNull();
    assertThat(lifecycle.creator).isNull();
    assertThat(sealed.names()).isEmpty();
  }

  @Test
  void rejectsMissingWorldCreationWhileTickingBeforeSealingOrCreating() {
    lifecycle.tickingWorlds = true;

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("before worlds start ticking");
    assertThat(server.getWorld("rwf_lobby")).isNull();
    assertThat(lifecycle.creator).isNull();
    assertThat(sealed.names()).isEmpty();
  }

  @Test
  void missingMapWorldRefusesStartupWithoutCreatingALobby() {
    var config =
        new RwfConfig.Worlds("rwf_lobby", "absent", RwfConfig.LobbyProvisioning.OWNED_VOID);

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), config, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("map world absent")
        .hasMessageContaining("must be provisioned and loaded");
    assertThat(server.getWorld("rwf_lobby")).isNull();
    assertThat(lifecycle.creator).isNull();
    assertThat(sealed.names()).isEmpty();
  }

  @Test
  void creationRefusalFailsWithoutSubstitutingAnotherWorld() {
    lifecycle.refuseCreation = true;

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("could not create or load");
    assertThat(server.getWorld("rwf_lobby")).isNull();
    assertThat(sealed.names()).isEmpty();
  }

  @Test
  void rejectsAnExistingLobbyWithTheWrongEnvironment() {
    var lobby =
        server.createWorld(
            WorldCreator.ofKey(NamespacedKey.minecraft("rwf_lobby"))
                .environment(World.Environment.NETHER));

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("must be NORMAL");
    assertThat(lifecycle.creator).isNull();
    assertThat(server.getWorld("rwf_lobby")).isSameAs(lobby);
  }

  @Test
  void aFailedPreparationPreservesAnExistingSeal() {
    sealed.seal("rwf_lobby");
    lifecycle.refuseCreation = true;

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class);

    assertThat(sealed.isSealed("rwf_lobby")).isTrue();
  }

  @Test
  void rejectsACreatedWorldWithAnUnexpectedIdentity() {
    lifecycle.wrongIdentity = true;

    assertThatThrownBy(() -> RwfWorlds.prepare(lifecycle.api(), CONFIG, sealed, new Random(42)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("identity does not match");
    assertThat(sealed.names()).isEmpty();
  }

  private final class ProvisioningServer {

    private @Nullable WorldCreator creator;
    private boolean refuseCreation;
    private boolean wrongIdentity;
    private boolean primaryThread = true;
    private boolean tickingWorlds;

    private Server api() {
      return Server.class.cast(
          Proxy.newProxyInstance(
              Server.class.getClassLoader(),
              new Class<?>[] {Server.class},
              (_, method, arguments) -> {
                return switch (method.getName()) {
                  case "isPrimaryThread" -> primaryThread;
                  case "isTickingWorlds" -> tickingWorlds;
                  case "getWorld" ->
                      server.getWorld(String.class.cast(requireNonNull(arguments)[0]));
                  case "createWorld" ->
                      createWorld(WorldCreator.class.cast(requireNonNull(arguments)[0]));
                  default -> throw new UnsupportedOperationException(method.toString());
                };
              }));
    }

    private @Nullable World createWorld(WorldCreator options) {
      assertThat(sealed.isSealed(options.name())).as("sealed before world-load callbacks").isTrue();
      creator = options;
      if (refuseCreation) {
        return null;
      }
      if (wrongIdentity) {
        return new WorldMock(WorldCreator.ofKey(NamespacedKey.minecraft("other")));
      }
      return server.createWorld(options);
    }
  }
}
