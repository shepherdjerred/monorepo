package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Writing mechanism signs on MockBukkit: track levels and land protection gate creation. */
final class SignWriteListenerTest {

  @TempDir Path directory;

  private ServerMock server;
  private MechanicsTestPlugin plugin;
  private WorldMock world;
  private PlayerMock player;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    MechanicsTestPlugin.directory = directory;
    plugin =
        MockBukkit.loadWith(
            MechanicsTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", MechanicsTestPlugin.class.getName()));
    world = server.addSimpleWorld("world");
    player = server.addPlayer("Alice");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  /** Grants a Mechanic level the way the tracks module does: that level and every one below. */
  private void grant(int level) {
    for (var reached = 1; reached <= level; reached++) {
      player.addAttachment(plugin, "thestorm.track.mechanic." + reached, true);
    }
  }

  private Block signAt(int x) {
    var block = world.getBlockAt(x, 64, 0);
    block.setType(Material.OAK_SIGN);
    return block;
  }

  private SignChangeEvent write(Block block, Side side, String... lines) {
    var components = new ArrayList<Component>();
    for (var line : lines) {
      components.add(Component.text(line));
    }
    var event = new SignChangeEvent(block, player, components, side);
    server.getPluginManager().callEvent(event);
    return event;
  }

  private List<String> messages() {
    var seen = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      seen.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return seen;
  }

  private String line(SignChangeEvent event, int index) {
    return PlainTextComponentSerializer.plainText()
        .serialize(Objects.requireNonNull(event.line(index)));
  }

  private String owner(Block block) {
    var sign = (Sign) block.getState();
    return sign.getPersistentDataContainer()
        .getOrDefault(
            new NamespacedKey(plugin, "mechanic_owner"), PersistentDataType.STRING, "none");
  }

  @Test
  void aPlayerWithoutTheLevelIsRefused() {
    grant(1);
    var block = signAt(5);

    var event = write(block, Side.FRONT, "", "[Lift Up]", "", "");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages()).containsExactly("[Elevator]: Building this needs Mechanic II.");
    assertThat(owner(block)).isEqualTo("none");
  }

  @Test
  void aMechanicBuildsAndTheTagIsNormalised() {
    grant(2);
    var block = signAt(5);

    var event = write(block, Side.FRONT, "Lobby", "[lift up]", "", "");

    assertThat(event.isCancelled()).isFalse();
    assertThat(line(event, 1)).isEqualTo("[Lift Up]");
    assertThat(line(event, 0)).isEqualTo("Lobby");
    assertThat(owner(block)).isEqualTo(player.getUniqueId().toString());
    assertThat(messages()).singleElement().asString().startsWith("[Elevator]: Built.");
  }

  @Test
  void landProtectionRefusesWithItsReason() {
    grant(5);
    var block = signAt(-5);

    var event = write(block, Side.FRONT, "", "[Lift Up]", "", "");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages()).containsExactly("[Elevator]: This land belongs to Aegis.");
  }

  @Test
  void aBadlyBuiltSignIsRefused() {
    grant(5);
    var block = signAt(5);

    // A hidden switch must hang on a wall; this one stands on a post.
    var event = write(block, Side.FRONT, "", "[X]", "", "");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages())
        .containsExactly("[Hidden Switch]: Put this sign on the side of a block.");
  }

  @Test
  void ordinaryTextIsLeftAlone() {
    var block = signAt(-5);

    var event = write(block, Side.FRONT, "Welcome", "to", "the", "Storm");

    assertThat(event.isCancelled()).isFalse();
    assertThat(line(event, 1)).isEqualTo("to");
    assertThat(messages()).isEmpty();
  }

  @Test
  void mechanismsBelongOnTheFront() {
    grant(5);
    var block = signAt(5);

    var event = write(block, Side.BACK, "", "[Lift]", "", "");

    assertThat(event.isCancelled()).isTrue();
    assertThat(messages())
        .containsExactly("[Elevator]: Mechanism signs are written on the front of a sign.");
  }
}
