package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PlotAccessTest {

  private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID FRIEND = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final UUID STRANGER = UUID.fromString("00000000-0000-0000-0000-000000000003");
  private static final PlotId PLOT = new PlotId(2, 1);
  private static final PlotId OTHER = new PlotId(3, 1);

  private final PlotMembership membership =
      new PlotMembership() {
        @Override
        public Optional<UUID> owner(PlotId id) {
          return PLOT.equals(id) ? Optional.of(OWNER) : Optional.empty();
        }

        @Override
        public Map<UUID, PlotRole> access(PlotId id) {
          return PLOT.equals(id) ? Map.of(FRIEND, PlotRole.TRUSTED) : Map.of();
        }
      };

  @Test
  void onlyTheOwnerTrustedMemberOrStaffMayChangeAPlot() {
    assertThat(change(false, OWNER, Optional.of(PLOT))).isTrue();
    assertThat(change(false, FRIEND, Optional.of(PLOT))).isTrue();
    assertThat(change(false, STRANGER, Optional.of(PLOT))).isFalse();
    assertThat(change(false, OWNER, Optional.empty())).isFalse();
    assertThat(change(false, STRANGER, Optional.of(OTHER))).isFalse();
    assertThat(change(true, STRANGER, Optional.empty())).isTrue();
    assertThat(PlotAccess.mayChange(false, Optional.empty(), Optional.of(PLOT), membership))
        .isFalse();
  }

  @Test
  void aRecoveredOwnerIsReadFromTheCatalogAndTrustIsEmpty() {
    var recovered = new RecoveredPlot(PLOT.text(), OWNER.toString(), List.of());
    var catalog = new CatalogMembership(PlotCatalog.of(List.of(recovered)));

    assertThat(catalog.owner(PLOT)).contains(OWNER);
    assertThat(catalog.access(PLOT)).isEmpty();
    assertThat(catalog.owner(OTHER)).isEmpty();
    assertThat(PlotAccess.mayChange(false, Optional.of(OWNER), Optional.of(PLOT), catalog))
        .isTrue();
    assertThat(PlotAccess.mayChange(false, Optional.of(STRANGER), Optional.of(PLOT), catalog))
        .isFalse();
  }

  @Test
  void pistonsFluidsAndExplosionsMustStayInsideOnePlot() {
    assertThat(PlotAccess.staysInsideOnePlot(List.of())).isTrue();
    assertThat(PlotAccess.staysInsideOnePlot(List.of(Optional.of(PLOT), Optional.of(PLOT))))
        .isTrue();
    assertThat(PlotAccess.staysInsideOnePlot(List.of(Optional.empty()))).isFalse();
    assertThat(PlotAccess.staysInsideOnePlot(List.of(Optional.of(PLOT), Optional.empty())))
        .isFalse();
    assertThat(PlotAccess.staysInsideOnePlot(List.of(Optional.of(PLOT), Optional.of(OTHER))))
        .isFalse();
  }

  @Test
  void entitySpawnsStopAtTheCapAndNeverLandOnARoad() {
    assertThat(PlotAccess.maySpawn(false, Optional.of(PLOT), 199, 200)).isTrue();
    assertThat(PlotAccess.maySpawn(false, Optional.of(PLOT), 200, 200)).isFalse();
    assertThat(PlotAccess.maySpawn(false, Optional.empty(), 0, 200)).isFalse();
    assertThat(PlotAccess.maySpawn(true, Optional.empty(), 500, 200)).isTrue();
  }

  @Test
  void commandBlocksStructureBlocksAndJigsawsCannotBePlaced() {
    assertThat(PlotAccess.forbiddenPlacement("minecraft:command_block")).isTrue();
    assertThat(PlotAccess.forbiddenPlacement("minecraft:chain_command_block")).isTrue();
    assertThat(PlotAccess.forbiddenPlacement("minecraft:repeating_command_block")).isTrue();
    assertThat(PlotAccess.forbiddenPlacement("minecraft:structure_block")).isTrue();
    assertThat(PlotAccess.forbiddenPlacement("minecraft:jigsaw")).isTrue();
    assertThat(PlotAccess.forbiddenPlacement("minecraft:command_block_minecart")).isTrue();
    assertThat(PlotAccess.forbiddenPlacement("minecraft:stone")).isFalse();
  }

  private boolean change(boolean staff, UUID actor, Optional<PlotId> plot) {
    return PlotAccess.mayChange(staff, Optional.of(actor), plot, membership);
  }
}
