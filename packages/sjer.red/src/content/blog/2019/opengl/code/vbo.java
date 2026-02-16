// Create a VBO and store its name
glVboName = glGenBuffers();

// Bind the VBO created in the last step
glBindBuffer(GL_ARRAY_BUFFER, glVboName);

float[] vertices = new float[]{
    0.0f, 0.5f, 0.0f,
    -0.5f, -0.5f, 0.0f,
    0.5f, -0.5f, 0.0f
};

try (var stack = MemoryStack.stackPush()) {
  // Allocate a native buffer to store the vertices
  var vertexBuffer = stack.mallocFloat(vertices.length);

  // Put the previously declared vertices into the float buffer
  vertexBuffer.put(vertices);
  vertexBuffer.flip();

  // Send the vertices to the graphics hardware
  glBufferData(GL_ARRAY_BUFFER, vertexBuffer, GL_STATIC_DRAW);
}
