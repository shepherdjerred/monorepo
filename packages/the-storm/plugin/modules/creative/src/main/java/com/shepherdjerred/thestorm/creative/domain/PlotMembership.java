package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Who holds a plot. Empty owner means nobody may build there except staff. */
public interface PlotMembership {

  /** The player who may build here, when one has been proven or has claimed it. */
  Optional<UUID> owner(PlotId id);

  /** Players the owner has trusted. The recovered signs did not record any. */
  Set<UUID> trusted(PlotId id);
}
