package com.shepherdjerred.thestorm.mechanics.domain.config;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;

/**
 * The sign copier: punch a sign with the tool to copy it, right-click another to paste.
 *
 * @param unlock who may use it
 * @param tool the item that copies and pastes
 */
public record SignCopierConfig(Unlock unlock, String tool) {

  public SignCopierConfig {
    Cell.requireMaterialKey(tool);
  }
}
