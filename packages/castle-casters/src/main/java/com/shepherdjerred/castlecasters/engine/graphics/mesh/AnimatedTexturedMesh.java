package com.shepherdjerred.castlecasters.engine.graphics.mesh;

import java.util.*;

public class AnimatedTexturedMesh {

  private final Map<Integer, TexturedMesh> frames = new HashMap<>();

  public void setFrame(Integer integer, TexturedMesh mesh) {
    frames.put(integer, mesh);
  }

  public Set<TexturedMesh> getMeshes() {
    return new LinkedHashSet<>(frames.values());
  }

  public void render(int frame) {
    var mesh = frames.get(frame);
    mesh.render();
  }
}
