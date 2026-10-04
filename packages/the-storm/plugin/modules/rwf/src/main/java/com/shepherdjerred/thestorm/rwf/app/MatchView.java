package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.Optional;

/**
 * The running match as a read model. The snapshot is immutable and rebuilt at most once per server
 * tick, so bots and displays may call this freely. Empty while the module has no match (before the
 * world is ready). Main thread only.
 */
public interface MatchView {

  Optional<MatchSnapshot> current();
}
