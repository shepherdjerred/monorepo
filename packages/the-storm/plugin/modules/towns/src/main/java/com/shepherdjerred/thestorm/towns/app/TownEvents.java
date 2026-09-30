package com.shepherdjerred.thestorm.towns.app;

import java.util.UUID;

/**
 * Told when towns change in memory, for views such as the web map. Called on the main thread right
 * after each change is applied; a failed save is followed by {@link #reloaded()}.
 */
public interface TownEvents {

  /** Nobody listens. */
  TownEvents NONE =
      new TownEvents() {
        @Override
        public void landChanged(UUID townId) {
          // Nothing to update.
        }

        @Override
        public void removed(UUID townId) {
          // Nothing to update.
        }

        @Override
        public void reloaded() {
          // Nothing to update.
        }
      };

  /** The town's claims or name changed. */
  void landChanged(UUID townId);

  /** The town was deleted. */
  void removed(UUID townId);

  /** Every town was reloaded from storage after a failed save. */
  void reloaded();
}
