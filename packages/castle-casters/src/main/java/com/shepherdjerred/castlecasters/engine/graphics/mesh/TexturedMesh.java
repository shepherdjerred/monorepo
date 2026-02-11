package com.shepherdjerred.castlecasters.engine.graphics.mesh;

import com.shepherdjerred.castlecasters.engine.graphics.texture.Texture;

public record TexturedMesh(Mesh mesh, Texture texture) {

  public void render() {
    texture.bind();
    mesh.render();
  }
}
