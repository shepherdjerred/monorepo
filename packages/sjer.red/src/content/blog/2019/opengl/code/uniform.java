// Create a new perspective matrix
var matrix = new Matrix4f().perspective(FIELD_OF_VIEW, aspectRatio, Z_NEAR, Z_FAR);

// Get the name of the matrix
glUniformName = glGetUniformLocation(glShaderProgramName, "projectionMatrix");

// Move the matrix to native memory, and then buffer it
try (MemoryStack stack = MemoryStack.stackPush()) {
  FloatBuffer fb = stack.mallocFloat(16);
  matrix.get(fb);
  glUniformMatrix4fv(glUniformName, false, fb);
}
