package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.util.Optional;

/**
 * The baked navigation artifacts by map id. An artifact is present only when it decoded, validated
 * and was baked from the terrain the match plays on; a map without one runs humans-only.
 */
public interface NavArtifacts {

  Optional<NavArtifact> forMap(String mapId);
}
