package com.shepherdjerred.thestorm.arena.adapter.content;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaBundle;
import com.shepherdjerred.thestorm.arena.domain.reward.RewardLedger;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import com.shepherdjerred.thestorm.arena.domain.wave.Difficulty;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveScaling;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The config and content the server ships load, agree, and keep the 2015 design. */
final class ShippedContentTest {

  /** {@code plugins/TheStorm} as the repository owns it, relative to this module. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm");

  private static ArenaBundle content;

  @BeforeAll
  static void load() {
    content = ContentFiles.load(SHIPPED);
  }

  @Test
  void thereAre72Waves() {
    assertThat(content.waves().finalWave()).isEqualTo(72);
  }

  @Test
  void aBossComesEveryTenWavesAndTheWardenEndsIt() {
    for (var wave = 10; wave <= 70; wave += 10) {
      assertThat(content.waves().kind(wave)).as("wave %d", wave).isEqualTo(WaveKind.BOSS);
    }
    assertThat(content.waves().kind(72)).isEqualTo(WaveKind.BOSS);
    assertThat(content.waves().entry(72).boss()).contains("warden");
    assertThat(content.waves().entry(70).boss()).contains("colossus");
    var colossus = content.waves().mob("colossus");
    assertThat(colossus.type()).isEqualTo("ZOMBIE");
    assertThat(colossus.scale()).isGreaterThanOrEqualTo(3);
  }

  @Test
  void theModernBossesAreAllThere() {
    var types = new HashSet<String>();
    content
        .waves()
        .bosses()
        .values()
        .forEach(boss -> types.add(content.waves().mob(boss.mob()).type()));

    assertThat(types)
        .contains("PIGLIN_BRUTE", "EVOKER", "RAVAGER", "BREEZE", "CREAKING", "WARDEN", "ZOMBIE");
    var creaking =
        content.waves().bosses().values().stream()
            .filter(boss -> content.waves().mob(boss.mob()).type().equals("CREAKING"))
            .findFirst()
            .orElseThrow();
    assertThat(creaking.hasHeart()).isTrue();
  }

  @Test
  void theWaveFiftyBossKeepsTheArchivedAbilities() {
    var boss =
        requireNonNull(
            content.waves().bosses().get(content.waves().entry(50).boss().orElseThrow()));

    assertThat(boss.abilities())
        .extracting(ability -> ability.type())
        .contains(AbilityType.LIGHTNING_AURA, AbilityType.CHAIN_LIGHTNING, AbilityType.DISORIENT);
  }

  @Test
  void swarmsComeOnTheFivesAndUpgradesFollowBosses() {
    for (var wave = 5; wave <= 65; wave += 10) {
      assertThat(content.waves().kind(wave)).as("wave %d", wave).isEqualTo(WaveKind.SWARM);
    }
    for (var wave = 11; wave <= 71; wave += 10) {
      assertThat(content.waves().kind(wave)).as("wave %d", wave).isEqualTo(WaveKind.UPGRADE);
    }
  }

  @Test
  void theModernSwarmsAndCavalryAppear() {
    var swarmTypes = new HashSet<String>();
    var mounts = new HashSet<String>();
    for (var wave = 1; wave <= 72; wave++) {
      var entry = content.waves().entry(wave);
      for (var group : entry.spawns()) {
        var mob = content.waves().mob(group.mob());
        if (entry.kind() == WaveKind.SWARM) {
          swarmTypes.add(mob.type());
        }
        if (entry.kind() == WaveKind.CAVALRY && mob.rider().isPresent()) {
          mounts.add(mob.type());
        }
      }
    }

    assertThat(swarmTypes).contains("VEX", "PHANTOM", "SILVERFISH", "SULFUR_CUBE", "SHEEP");
    assertThat(mounts).contains("ZOMBIE_HORSE", "CAMEL_HUSK");
  }

  @Test
  void everySoloWaveFitsUnderTheEntityCapAtOnce() {
    var cap = content.settings().waves().entityCap();
    for (var tier = 1; tier <= content.settings().tiers().size(); tier++) {
      var solo = new Difficulty(1, content.settings().tier(tier), content.settings().scaling());
      for (var wave = 1; wave <= 72; wave++) {
        var resolved = content.waves().resolve(wave, solo);
        var entities = resolved.units().stream().mapToInt(unit -> unit.entities()).sum();
        entities += resolved.boss().map(boss -> boss.entities()).orElse(0);
        assertThat(entities).as("wave %d on tier %d", wave, tier).isLessThanOrEqualTo(cap);
      }
    }
  }

  @Test
  void soloWavesStayModest() {
    var solo = new Difficulty(1, content.settings().tier(1), content.settings().scaling());
    for (var wave = 1; wave <= 72; wave++) {
      var resolved = content.waves().resolve(wave, solo);
      assertThat(resolved.units().size()).as("wave %d", wave).isLessThanOrEqualTo(20);
      resolved
          .boss()
          .ifPresent(
              boss -> assertThat(boss.maxHealth()).isLessThanOrEqualTo(WaveScaling.MAX_HEALTH / 2));
    }
  }

  @Test
  void aSoloFullClearEarnsExactlyTheCapOnTheFirstTier() {
    var rewards = content.settings().rewards();
    var tier = content.settings().tier(1);
    var player = UUID.randomUUID();
    var ledger = RewardLedger.EMPTY;
    var total = 0L;
    for (var wave = 1; wave <= 72; wave++) {
      var grant =
          ledger.grant(
              player,
              rewards.waveReward(wave, content.waves().kind(wave), tier),
              rewards.capPerGame());
      ledger = grant.ledger();
      total += grant.amount();
    }

    assertThat(rewards.capPerGame()).isEqualTo(750);
    assertThat(rewards.firstWave()).isEqualTo(30);
    assertThat(total).isEqualTo(750);
  }

  @Test
  void thereAreFiveOminousTiers() {
    assertThat(content.settings().tiers())
        .extracting(tier -> tier.name())
        .containsExactly("Ominous I", "Ominous II", "Ominous III", "Ominous IV", "Ominous V");
  }

  @Test
  void theNineOriginalClassesAreOpenToEveryone() {
    var classes = content.classes().classes();

    for (var id :
        List.of(
            "archer",
            "madman",
            "guardian",
            "healer",
            "wolfmaster",
            "tank",
            "knight",
            "oddjob",
            "chemist")) {
      assertThat(classes).containsKey(id);
      assertThat(requireNonNull(classes.get(id)).advanced()).as(id).isFalse();
    }
    assertThat(requireNonNull(classes.get("wolfmaster")).wolves()).isEqualTo(7);
    assertThat(requireNonNull(classes.get("archer")).wolves()).isEqualTo(3);
    assertThat(classes.values()).anyMatch(arenaClass -> arenaClass.advanced());
  }

  @Test
  void everyClassCarriesHealingAndGetsAnUpgrade() {
    for (var entry : content.classes().classes().entrySet()) {
      var kit = entry.getValue();
      assertThat(kit.items())
          .as(entry.getKey())
          .anyMatch(item -> item.potion().filter(p -> p.contains("healing")).isPresent());
      assertThat(kit.upgrade()).as(entry.getKey()).isNotEmpty();
    }
  }

  @Test
  void theExampleArenaIsForASmallServer() {
    assertThat(content.arenas()).hasSize(1);
    var arena = content.arenas().getFirst();

    assertThat(arena.id()).isEqualTo("colosseum");
    assertThat(arena.minPlayers()).isEqualTo(1);
    assertThat(arena.maxPlayers()).isLessThanOrEqualTo(4);
    assertThat(arena.classSigns().keySet()).isEqualTo(content.classes().classes().keySet());
  }

  @Test
  void vaultMilestonesIncludeEveryBossWave() {
    var milestones =
        content.settings().rewards().vault().milestones().stream().map(m -> m.wave()).toList();

    assertThat(milestones).contains(10, 20, 30, 40, 50, 60, 70, 72);
  }
}
