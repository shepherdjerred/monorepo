package com.shepherdjerred.thestorm.client;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RecoveryTargetTest {
  @Test
  void acceptsOnlyTheSavedSignInItsSavedWorldWithoutMovingInputs() {
    var args =
        Protocol.JSON.readTree(
            "{\"expectedWorld\":\"minecraft:overworld\",\"expectedBlock\":[1,2,3]}");
    assertDoesNotThrow(() ->
        RecoveryTarget.verify(
            args,
            new RecoveryTarget.Observed(
                "minecraft:overworld", List.of(1, 2, 3), true, Set.of("sneak"))));
    assertThrows(
        IllegalStateException.class,
        () ->
            RecoveryTarget.verify(
                args,
                new RecoveryTarget.Observed(
                    "minecraft:the_nether", List.of(1, 2, 3), true, Set.of())));
    assertThrows(
        IllegalStateException.class,
        () ->
            RecoveryTarget.verify(
                args,
                new RecoveryTarget.Observed(
                    "minecraft:overworld", List.of(1, 2, 4), true, Set.of())));
    assertThrows(
        IllegalStateException.class,
        () ->
            RecoveryTarget.verify(
                args,
                new RecoveryTarget.Observed("minecraft:overworld", List.of(), true, Set.of())));
    assertThrows(
        IllegalStateException.class,
        () ->
            RecoveryTarget.verify(
                args,
                new RecoveryTarget.Observed(
                    "minecraft:overworld", List.of(1, 2, 3), false, Set.of())));
    assertThrows(
        IllegalStateException.class,
        () ->
            RecoveryTarget.verify(
                args,
                new RecoveryTarget.Observed(
                    "minecraft:overworld", List.of(1, 2, 3), true, Set.of("forward"))));
  }
}
