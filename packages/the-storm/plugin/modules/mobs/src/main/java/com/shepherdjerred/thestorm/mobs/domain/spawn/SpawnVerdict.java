package com.shepherdjerred.thestorm.mobs.domain.spawn;

/** What happens to a spawning mob. */
public sealed interface SpawnVerdict {

  /** The mob gets a level. */
  record Level() implements SpawnVerdict {}

  /** The mob spawns as vanilla made it. */
  record Leave(Reason reason) implements SpawnVerdict {}

  /** The spawn is stopped. */
  record Block() implements SpawnVerdict {}

  /** Why a mob is left alone. */
  enum Reason {
    ARENA,
    NOT_HOSTILE,
    ADMIN_REGION,
    BOSS,
    EXCLUDED_TYPE,
    NAMED,
    TAMED,
    BABY,
    UNLEVELLED_REASON
  }
}
