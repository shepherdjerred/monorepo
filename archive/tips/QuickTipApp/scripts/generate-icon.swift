#!/usr/bin/env swift
// Generate Tips app icon: lightbulb.fill SF Symbol on warm gradient background
// Usage: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift generate-icon.swift <output-path>

import AppKit

let size = 1024
let outputPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon_1024x1024.png"

/// Create bitmap
guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    print("ERROR: Could not create bitmap image rep")
    exit(1)
}

guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
    print("ERROR: Could not create graphics context")
    exit(1)
}
NSGraphicsContext.current = context
let cgContext = context.cgContext

let rect = CGRect(x: 0, y: 0, width: size, height: size)

// Draw rounded rect background with warm gradient
let cornerRadius: CGFloat = .init(size) * 0.22
let path = NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius)
path.addClip()

// Gradient: warm yellow (#FFB800) to orange (#FF8C00)
let colorSpace = CGColorSpaceCreateDeviceRGB()
let colors = [
    CGColor(red: 1.0, green: 0.55, blue: 0.0, alpha: 1.0), // #FF8C00 (bottom)
    CGColor(red: 1.0, green: 0.72, blue: 0.0, alpha: 1.0) // #FFB800 (top)
] as CFArray
guard let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0.0, 1.0]) else {
    print("ERROR: Could not create gradient")
    exit(1)
}
cgContext.drawLinearGradient(
    gradient,
    start: CGPoint(x: CGFloat(size) / 2, y: 0),
    end: CGPoint(x: CGFloat(size) / 2, y: CGFloat(size)),
    options: []
)

// Draw lightbulb.fill SF Symbol in white
let symbolSize: CGFloat = 620
let config = NSImage.SymbolConfiguration(pointSize: symbolSize, weight: .regular)
if let symbolImage = NSImage(systemSymbolName: "lightbulb.fill", accessibilityDescription: nil)?
    .withSymbolConfiguration(config) {
    let imageSize = symbolImage.size

    // Center the symbol
    let x = (CGFloat(size) - imageSize.width) / 2
    let y = (CGFloat(size) - imageSize.height) / 2

    // Tint to white by drawing into a temporary image
    let tinted = NSImage(size: imageSize)
    tinted.lockFocus()
    NSColor.white.set()
    let tintRect = CGRect(origin: .zero, size: imageSize)
    symbolImage.draw(in: tintRect)
    tintRect.fill(using: .sourceAtop)
    tinted.unlockFocus()

    tinted.draw(
        in: CGRect(x: x, y: y, width: imageSize.width, height: imageSize.height),
        from: .zero,
        operation: .sourceOver,
        fraction: 1.0
    )
} else {
    print("ERROR: Could not load lightbulb.fill SF Symbol")
    exit(1)
}

NSGraphicsContext.current = nil

// Save as PNG
guard let pngData = rep.representation(using: .png, properties: [:]) else {
    print("ERROR: Could not create PNG representation")
    exit(1)
}
let url = URL(fileURLWithPath: outputPath)
do {
    try pngData.write(to: url)
} catch {
    print("ERROR: Could not write PNG to \(outputPath): \(error)")
    exit(1)
}
print("Saved icon to \(outputPath)")
