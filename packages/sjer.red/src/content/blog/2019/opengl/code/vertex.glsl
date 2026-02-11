#version 330 core

// A vector of 3 floats at index 0 of the VAO
layout (location = 0) in vec3 position;

// A vector of 4 floats at index 1 of the VAO
layout (location = 1) in vec4 inColor;

// Output a vector of 4 floats
out vec4 color;

// A global 4x4 matrix
uniform mat4 projectionMatrix;

void main() {
    // Transform the position of the vertex by the projection matrix
    gl_Position = projectionMatrix * vec4(position, 1.0);

    // Pass the color to the fragment shader
    color = inColor;
}
