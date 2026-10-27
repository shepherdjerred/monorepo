package com.shepherdjerred.thestorm.mechanics.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class StargateAccessTest {
  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void creationRequiresLoadedMechanicThreeAndNetworkAccess() {
    var player = MockBukkit.mock().addPlayer();
    var playerId = player.getUniqueId();
    var loaded = new boolean[] {false};
    var level = new int[] {0};
    TrackLevels tracks =
        new TrackLevels() {
          @Override
          public boolean isLoaded(UUID id) {
            return loaded[0];
          }

          @Override
          public int level(Player subject, Track track) {
            return level[0];
          }
        };
    var townId = UUID.fromString("00000000-0000-0000-0000-000000000002");
    var access =
        new StargateAccess(
            tracks, member -> member.equals(playerId) ? Optional.of(townId) : Optional.empty());
    var network = new NetworkAccess.Town(townId);

    assertThat(access.mayCreate(player, network)).isFalse();
    loaded[0] = true;
    level[0] = 2;
    assertThat(access.mayCreate(player, network)).isFalse();
    level[0] = 3;
    assertThat(access.mayCreate(player, network)).isTrue();
    assertThat(access.mayCreate(player, new NetworkAccess.Town(playerId))).isFalse();
  }

  @Test
  void townNetworkUseFollowsCurrentMembership() {
    var player = MockBukkit.mock().addPlayer();
    var townId = UUID.fromString("00000000-0000-0000-0000-000000000002");
    var membership = new boolean[] {false};
    TrackLevels tracks =
        new TrackLevels() {
          @Override
          public boolean isLoaded(UUID id) {
            return false;
          }

          @Override
          public int level(Player subject, Track track) {
            return 0;
          }
        };
    var access =
        new StargateAccess(
            tracks, member -> membership[0] ? Optional.of(townId) : Optional.empty());
    var network = new NetworkAccess.Town(townId);

    assertThat(access.mayUse(player, network)).isFalse();
    membership[0] = true;
    assertThat(access.mayUse(player, network)).isTrue();
    membership[0] = false;
    assertThat(access.mayUse(player, network)).isFalse();
  }
}
