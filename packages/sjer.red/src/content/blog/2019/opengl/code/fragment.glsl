#version 330 core

// A vector of 4 floats in
in vec4 color;

// A vector of 4 floats out
out vec4 outColor;

void main() {
    // Set the outgoing color to the incoming color
    outColor = color;
}

