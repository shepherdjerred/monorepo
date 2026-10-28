package com.shepherdjerred.thestorm.advancements.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import java.util.Collection;
import net.kyori.adventure.text.Component;
import org.bukkit.GameRules;
import org.bukkit.NamespacedKey;
import org.bukkit.advancement.Advancement;
import org.bukkit.advancement.AdvancementRequirements;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Chat for a new Storm milestone, including worlds that hide advancement messages. */
final class AdvancementAwarderTest {

  private ServerMock server;
  private AdvancementAwarder awarder;
  private PlayerMock alice;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    awarder = new AdvancementAwarder(server);
    alice = server.addPlayer("Alice");
  }

  @AfterEach
  void stop() {
    PlayerVisibility.set(alice, false);
    MockBukkit.unmock();
  }

  @Test
  void catchUpDropsTheChatLine() {
    var event = done(alice, "thestorm:a_survival/home", Component.text("already had it"));
    awarder.earnedNow = false;

    awarder.quietCatchUp(event);

    assertThat(event.message()).isNull();
  }

  @Test
  void aNewMilestoneKeepsTheChatLine() {
    var message = Component.text("just earned");
    var event = done(alice, "thestorm:a_survival/home", message);

    awarder.quietCatchUp(event);

    assertThat(event.message()).isEqualTo(message);
  }

  @Test
  void aVanishedPlayersStormMilestoneDropsTheChatLine() {
    PlayerVisibility.set(alice, true);
    var event = done(alice, "thestorm:a_survival/home", Component.text("vanished"));

    awarder.quietCatchUp(event);

    assertThat(event.message()).isNull();
  }

  @Test
  void aVanishedPlayersVanillaAdvancementKeepsTheChatLine() {
    PlayerVisibility.set(alice, true);
    var message = Component.text("Stone Age");
    var event = done(alice, "minecraft:story/mine_stone", message);

    awarder.quietCatchUp(event);

    assertThat(event.message()).isEqualTo(message);
  }

  @Test
  void saysAStormMilestoneWhenTheWorldHidesAdvancementChat() {
    var bob = server.addPlayer("Bob");
    var message = Component.text("has made the advancement");
    alice.getWorld().setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, false);

    awarder.showWhereChatIsHidden(done(alice, "thestorm:f_search/matches/1", message));

    assertThat(alice.nextComponentMessage()).isEqualTo(message);
    assertThat(bob.nextComponentMessage()).isEqualTo(message);
  }

  @Test
  void leavesTheChatLineToTheGameWhenTheWorldAlreadyShowsIt() {
    var message = Component.text("has made the advancement");
    alice.getWorld().setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, true);

    awarder.showWhereChatIsHidden(done(alice, "thestorm:a_survival/home", message));

    assertThat(alice.nextComponentMessage()).isNull();
  }

  @Test
  void doesNotSayVanillaAdvancementsThatTheWorldHid() {
    alice.getWorld().setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, false);

    awarder.showWhereChatIsHidden(
        done(alice, "minecraft:story/mine_stone", Component.text("Stone Age")));

    assertThat(alice.nextComponentMessage()).isNull();
  }

  @Test
  void doesNotSayAHiddenPlayersMilestone() {
    alice.getWorld().setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, false);
    PlayerVisibility.set(alice, true);

    awarder.showWhereChatIsHidden(
        done(alice, "thestorm:f_search/matches/1", Component.text("Bravo Six, going dark")));

    assertThat(alice.nextComponentMessage()).isNull();
  }

  @Test
  void catchUpInAQuietWorldDoesNotBroadcast() {
    alice.getWorld().setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, false);
    var event = done(alice, "thestorm:c_skills/mining/100", Component.text("Time to Mine!"));
    awarder.earnedNow = false;

    awarder.quietCatchUp(event);
    awarder.showWhereChatIsHidden(event);

    assertThat(alice.nextComponentMessage()).isNull();
  }

  private static PlayerAdvancementDoneEvent done(Player player, String id, Component message) {
    return new PlayerAdvancementDoneEvent(player, named(id), message);
  }

  private static Advancement named(String id) {
    return new Advancement() {
      @Override
      public NamespacedKey getKey() {
        var key = NamespacedKey.fromString(id);
        if (key == null) {
          throw new IllegalStateException(id);
        }
        return key;
      }

      @Override
      public Collection<String> getCriteria() {
        throw new UnsupportedOperationException();
      }

      @Override
      public AdvancementRequirements getRequirements() {
        throw new UnsupportedOperationException();
      }

      @Override
      public io.papermc.paper.advancement.AdvancementDisplay getDisplay() {
        throw new UnsupportedOperationException();
      }

      @Override
      public Component displayName() {
        throw new UnsupportedOperationException();
      }

      @Override
      public Advancement getParent() {
        throw new UnsupportedOperationException();
      }

      @Override
      public Collection<Advancement> getChildren() {
        throw new UnsupportedOperationException();
      }

      @Override
      public Advancement getRoot() {
        throw new UnsupportedOperationException();
      }
    };
  }
}
