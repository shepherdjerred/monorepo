package com.shepherdjerred.thestorm.stats.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.stats.domain.CombatClassifier.CombatActor;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier.SurvivalContext;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ClassifiersTest {

  private static final UUID ALICE_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
  private static final UUID BOB_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
  private static final UUID FLOODGATE_ID = UUID.fromString("00000000-0000-0000-0009-01f9e3d21001");

  @Test
  void platformAndProtocolVersionsMapCleanly() {
    assertThat(Platform.detect(FLOODGATE_ID, null)).isEqualTo(Platform.BEDROCK);
    assertThat(Platform.detect(ALICE_ID, "Geyser")).isEqualTo(Platform.BEDROCK);
    assertThat(Platform.detect(ALICE_ID, "vanilla")).isEqualTo(Platform.JAVA);
    assertThat(Platform.detect(ALICE_ID, null)).isEqualTo(Platform.JAVA);

    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 775)).isEqualTo("26.3");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 780)).isEqualTo("26.3");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 770)).isEqualTo("1.21.5");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 769)).isEqualTo("1.21.4");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 768)).isEqualTo("1.21.2");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 767)).isEqualTo("1.21.1");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 500)).isEqualTo("protocol-500");
    assertThat(ProtocolVersions.clientVersion(Platform.BEDROCK, -1)).isEqualTo("bedrock");
    assertThat(ProtocolVersions.clientVersion(Platform.JAVA, 0)).isEqualTo("unknown");
  }

  @Test
  void worldAndModeClassifiersCoverEveryStormWorldAndMinigame() {
    assertThat(WorldClassifier.classifyWorld("world", false)).isEqualTo(WorldBucket.WORLD);
    assertThat(WorldClassifier.classifyWorld("world_nether", false))
        .isEqualTo(WorldBucket.WORLD_NETHER);
    assertThat(WorldClassifier.classifyWorld("world_the_end", false))
        .isEqualTo(WorldBucket.WORLD_THE_END);
    assertThat(WorldClassifier.classifyWorld("skylands", false)).isEqualTo(WorldBucket.SKYLANDS);
    assertThat(WorldClassifier.classifyWorld("creative", false)).isEqualTo(WorldBucket.CREATIVE);
    assertThat(WorldClassifier.classifyWorld("rwf", false)).isEqualTo(WorldBucket.RWF);
    assertThat(WorldClassifier.classifyWorld("rwf_lobby", false)).isEqualTo(WorldBucket.RWF);
    assertThat(WorldClassifier.classifyWorld("world", true)).isEqualTo(WorldBucket.ARENA);
    assertThat(WorldClassifier.classifyWorld("arena_colosseum", false))
        .isEqualTo(WorldBucket.ARENA);
    assertThat(WorldClassifier.classifyWorld("frontier", false)).isEqualTo(WorldBucket.OTHER);

    assertThat(WorldClassifier.classifyMode(WorldBucket.WORLD, false, false))
        .isEqualTo(GameModeBucket.SURVIVAL);
    assertThat(WorldClassifier.classifyMode(WorldBucket.WORLD, false, true))
        .isEqualTo(GameModeBucket.CREATIVE);
    assertThat(WorldClassifier.classifyMode(WorldBucket.CREATIVE, false, false))
        .isEqualTo(GameModeBucket.CREATIVE);
    assertThat(WorldClassifier.classifyMode(WorldBucket.ARENA, true, false))
        .isEqualTo(GameModeBucket.ARENA);
    assertThat(WorldClassifier.classifyMode(WorldBucket.RWF, false, false))
        .isEqualTo(GameModeBucket.RWF);

    assertThat(WorldClassifier.isSurvivalCombatWorld(WorldBucket.WORLD, false)).isTrue();
    assertThat(WorldClassifier.isSurvivalCombatWorld(WorldBucket.OTHER, false)).isTrue();
    assertThat(WorldClassifier.isSurvivalCombatWorld(WorldBucket.WORLD, true)).isFalse();
    assertThat(WorldClassifier.isSurvivalCombatWorld(WorldBucket.RWF, false)).isFalse();
    assertThat(WorldClassifier.isSurvivalCombatWorld(WorldBucket.ARENA, false)).isFalse();
    assertThat(WorldClassifier.isSurvivalCombatWorld(WorldBucket.CREATIVE, false)).isFalse();
  }

  @Test
  void joinAddressesStripPortForgeSuffixesAndTrailingDots() {
    assertThat(JoinAddresses.normalize("TS-MC.NET:25565")).isEqualTo("ts-mc.net");
    assertThat(JoinAddresses.normalize("mc.ts-mc.net.:25565")).isEqualTo("mc.ts-mc.net");
    assertThat(JoinAddresses.normalize("ts-mc.net:25565\0FML3\0")).isEqualTo("ts-mc.net");
    assertThat(JoinAddresses.normalize("ts-mc.net\0FML\0:25565")).isEqualTo("ts-mc.net");
    assertThat(JoinAddresses.normalize("[::1]:25565")).isEqualTo("::1");
    assertThat(JoinAddresses.normalize("   ")).isNull();
    assertThat(JoinAddresses.normalize(null)).isNull();
  }

  @Test
  void bounceClassifierStripsFormattingRedactsSecretsAndTruncatesTo240Chars() {
    assertThat(BounceClassifier.classifyPreLogin("KICK_BANNED", "Banned"))
        .isEqualTo(BounceCategory.BANNED);
    assertThat(BounceClassifier.classifyPreLogin("KICK_WHITELIST", ""))
        .isEqualTo(BounceCategory.ALLOWLIST);
    assertThat(BounceClassifier.classifyPreLogin("KICK_FULL", "")).isEqualTo(BounceCategory.FULL);
    assertThat(BounceClassifier.classifyPreLogin("KICK_OTHER", "Server closed for maintenance"))
        .isEqualTo(BounceCategory.MAINTENANCE);
    assertThat(BounceClassifier.classifyPreLogin("KICK_OTHER", "Please wait"))
        .isEqualTo(BounceCategory.OTHER);
    assertThat(BounceClassifier.classifyKick("IDLING", "Idle too long"))
        .isEqualTo(BounceCategory.KICKED);
    assertThat(BounceClassifier.classifyKick("BANNED", "Banned")).isEqualTo(BounceCategory.BANNED);

    var formatted =
        "§c<red>Denied!</red> §x§1§2§3§4§5§6Auth Bearer supersecret123 token=my_secret_value phc_AbCdEf123456";
    var clean = BounceClassifier.sanitizeReason(formatted);
    assertThat(clean)
        .isEqualTo("Denied! Auth Bearer [redacted] token=[redacted] [redacted]")
        .doesNotContain("supersecret123")
        .doesNotContain("my_secret_value")
        .doesNotContain("phc_AbCdEf123456");

    var longReason = "word ".repeat(100);
    var truncated = BounceClassifier.sanitizeReason(longReason);
    assertThat(truncated.length()).isLessThanOrEqualTo(BounceClassifier.MAX_REASON_LENGTH);
  }

  @Test
  void combatClassifierIgnoresMinigameWorldsAndNormalizesWeapons() {
    var alice = new CombatActor(ALICE_ID, "Alice");
    var bob = new CombatActor(BOB_ID, "Bob");
    var survival = new SurvivalContext(WorldBucket.WORLD, false);
    var rwf = new SurvivalContext(WorldBucket.RWF, false);
    var arena = new SurvivalContext(WorldBucket.WORLD, true);
    var creative = new SurvivalContext(WorldBucket.CREATIVE, false);

    assertThat(CombatClassifier.pvp(alice, bob, "DIAMOND_SWORD", rwf)).isEmpty();
    assertThat(CombatClassifier.pvp(alice, bob, "DIAMOND_SWORD", arena)).isEmpty();
    assertThat(CombatClassifier.pveKill(alice, "ZOMBIE", "BOW", creative)).isEmpty();

    var pvp = CombatClassifier.pvp(alice, bob, "minecraft:diamond_sword", survival).orElseThrow();
    assertThat(pvp.kind()).isEqualTo(CombatKind.PVP);
    assertThat(pvp.weapon()).isEqualTo("DIAMOND_SWORD");
    assertThat(pvp.killer()).isEqualTo(alice);
    assertThat(pvp.victim()).isEqualTo(bob);

    var bareHandPvp = CombatClassifier.pvp(alice, bob, "AIR", survival).orElseThrow();
    assertThat(bareHandPvp.weapon()).isEqualTo("FISTS");

    var selfKill = CombatClassifier.pvp(alice, alice, "TNT", survival).orElseThrow();
    assertThat(selfKill.kind()).isEqualTo(CombatKind.ENV_DEATH);
    assertThat(selfKill.killer()).isNull();
    assertThat(selfKill.victim()).isEqualTo(alice);

    var pveKill = CombatClassifier.pveKill(alice, "skeleton", "bow", survival).orElseThrow();
    assertThat(pveKill.kind()).isEqualTo(CombatKind.PVE_KILL);
    assertThat(pveKill.mobType()).isEqualTo("SKELETON");
    assertThat(pveKill.weapon()).isEqualTo("BOW");

    var pveDeath =
        CombatClassifier.pveDeath(bob, "creeper", "ENTITY_EXPLOSION", survival).orElseThrow();
    assertThat(pveDeath.kind()).isEqualTo(CombatKind.PVE_DEATH);
    assertThat(pveDeath.mobType()).isEqualTo("CREEPER");

    var envDeath = CombatClassifier.envDeath(bob, "FALL", survival).orElseThrow();
    assertThat(envDeath.kind()).isEqualTo(CombatKind.ENV_DEATH);
    assertThat(envDeath.weapon()).isEqualTo("FALL");
  }
}
