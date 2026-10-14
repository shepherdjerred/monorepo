package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;

/** Actual positions reported by the shared human and bot tactical-item adapter. */
public sealed interface TacticalInput extends AbilityInput.Extra {
  record Supply(Vec3 at) implements TacticalInput {}

  record Deploy(Vec3 at) implements TacticalInput {}

  record Smoke(Vec3 at) implements TacticalInput {}

  record Rally(Vec3 at) implements TacticalInput {}
}
