package com.shepherdjerred.castlecasters.engine.graphics.mesh;

import com.google.common.base.Preconditions;
import lombok.ToString;
import org.lwjgl.system.MemoryStack;

import static com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper.unbindBuffer;
import static com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper.unbindVertexArray;
import static org.lwjgl.opengl.GL30.*;

/**
 * A 3D object that is drawable and has a texture.
 */
@ToString
public class Mesh {

  private static final int VERTICES_BUFFER_INDEX = 0;
  private static final int TEXTURE_COORDINATES_BUFFER_INDEX = 1;

  private final int indicesLength;
  private final int glVaoId;
  private final int glPositionsVboId;
  private final int glTextureCoordinatesVboId;
  private final int glIndicesVboId;
  private boolean isRenderable;

  public Mesh(float[] vertices,
              float[] textureCoordinates,
              int[] indices) {
    Preconditions.checkArgument(indices.length % 3 == 0);
    Preconditions.checkArgument(textureCoordinates.length % 2 == 0);
//    Preconditions.checkArgument(indices.length / 3 == textureCoordinates.length / 6);

    this.isRenderable = false;
    this.indicesLength = indices.length;

    glVaoId = glGenVertexArrays();
    glPositionsVboId = glGenBuffers();
    glTextureCoordinatesVboId = glGenBuffers();
    glIndicesVboId = glGenBuffers();

    bindVertexArray();

    try (var stack = MemoryStack.stackPush()) {
      var verticesBuffer = stack.mallocFloat(vertices.length);
      verticesBuffer.put(vertices).flip();
      bindGlPositionsVbo();
      glBufferData(GL_ARRAY_BUFFER, verticesBuffer, GL_STATIC_DRAW);
      glVertexAttribPointer(VERTICES_BUFFER_INDEX, 3, GL_FLOAT, false, 0, 0);
      glEnableVertexAttribArray(VERTICES_BUFFER_INDEX);

      var textureCoordinatesBuffer = stack.mallocFloat(textureCoordinates.length);
      bindGlTextureCoordinatesVbo();
      textureCoordinatesBuffer.put(textureCoordinates).flip();
      glBufferData(GL_ARRAY_BUFFER, textureCoordinatesBuffer, GL_STATIC_DRAW);
      glVertexAttribPointer(TEXTURE_COORDINATES_BUFFER_INDEX, 2, GL_FLOAT, false, 0, 0);
      glEnableVertexAttribArray(TEXTURE_COORDINATES_BUFFER_INDEX);

      var indicesBuffer = stack.mallocInt(indices.length);
      indicesBuffer.put(indices).flip();
      bindGlIndicesBuffer();
      glBufferData(GL_ELEMENT_ARRAY_BUFFER, indicesBuffer, GL_STATIC_DRAW);
    }

    unbindVertexArray();
    unbindBuffer();
    this.isRenderable = true;
  }

  private void bindVertexArray() {
    glBindVertexArray(glVaoId);
  }

  private void bindGlPositionsVbo() {
    glBindBuffer(GL_ARRAY_BUFFER, glPositionsVboId);
  }

  private void bindGlTextureCoordinatesVbo() {
    glBindBuffer(GL_ARRAY_BUFFER, glTextureCoordinatesVboId);
  }

  private void bindGlIndicesBuffer() {
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, glIndicesVboId);
  }

  /**
   * Draws this object.
   */
  public void render() {
    if (!isRenderable) {
      throw new IllegalStateException();
    }

    // Activate first texture bank
    glActiveTexture(GL_TEXTURE0);

    glBindVertexArray(glVaoId);
    glDrawElements(GL_TRIANGLES, indicesLength, GL_UNSIGNED_INT, 0);
    unbindVertexArray();
  }

  /**
   * Cleans up OpenGL resources.
   */
  public void cleanup() {
    isRenderable = false;

    unbindBuffer();
    glDeleteBuffers(glPositionsVboId);
    glDeleteBuffers(glTextureCoordinatesVboId);
    glDeleteBuffers(glIndicesVboId);

    unbindVertexArray();
    glDeleteVertexArrays(glVaoId);
  }
}
