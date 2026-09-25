package com.shepherdjerred.thestorm.tracks.adapter.luckperms;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tracks.adapter.luckperms.LuckPermsPlan.GroupDeclaration;
import com.shepherdjerred.thestorm.tracks.adapter.luckperms.LuckPermsPlan.NodeSpec;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.HashSet;
import java.util.List;
import org.junit.jupiter.api.Test;

final class LuckPermsPlanTest {

  @Test
  void everyTrackLevelIsDeclaredOnce() {
    var names = LuckPermsPlan.declarations().stream().map(GroupDeclaration::name).toList();

    assertThat(names).hasSize(Track.values().length * Track.MAX_LEVEL).doesNotHaveDuplicates();
  }

  @Test
  void levelOneGrantsOnlyItsPermission() {
    assertThat(LuckPermsPlan.declarations())
        .contains(
            new GroupDeclaration(
                "storm-mechanic-1", List.of(new NodeSpec.Permission("thestorm.track.mechanic.1"))));
  }

  @Test
  void higherLevelsGrantTheirPermissionAndInheritTheLevelBelow() {
    assertThat(LuckPermsPlan.declarations())
        .contains(
            new GroupDeclaration(
                "storm-engineer-4",
                List.of(
                    new NodeSpec.Permission("thestorm.track.engineer.4"),
                    new NodeSpec.Inherit("storm-engineer-3"))));
  }

  @Test
  void parentsAreDeclaredBeforeTheGroupsThatInheritThem() {
    var declared = new HashSet<String>();
    for (var declaration : LuckPermsPlan.declarations()) {
      for (var node : declaration.nodes()) {
        if (node instanceof NodeSpec.Inherit(var parent)) {
          assertThat(declared).as("%s before %s", parent, declaration.name()).contains(parent);
        }
      }
      declared.add(declaration.name());
    }
  }

  @Test
  void aPlayerInheritsOneGroupPerOwnedTrack() {
    assertThat(LuckPermsPlan.memberships(owning(MECHANIC, 3, ENGINEER, 1)))
        .containsExactlyInAnyOrder(
            new NodeSpec.Inherit("storm-mechanic-3"), new NodeSpec.Inherit("storm-engineer-1"));
  }

  @Test
  void anUntrainedPlayerInheritsNoTrackGroup() {
    assertThat(LuckPermsPlan.memberships(TrackProgress.empty())).isEmpty();
  }

  @Test
  void onlyTrackGroupMembershipsAreCleared() {
    assertThat(LuckPermsPlan.managed("storm-mechanic-3")).isTrue();
    assertThat(LuckPermsPlan.managed("storm-governor-5")).isTrue();
    assertThat(LuckPermsPlan.managed("default")).isFalse();
    assertThat(LuckPermsPlan.managed("admin")).isFalse();
    assertThat(LuckPermsPlan.managed("storm-staff")).isFalse();
    assertThat(LuckPermsPlan.managed("storm-mechanic-6")).isFalse();
  }
}
