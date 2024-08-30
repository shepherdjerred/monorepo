// swift-tools-version:5.3

import PackageDescription

let package = Package(
        name: "AdventOfCode",
        targets: [
            .target(
                    name: "Day1",
                    resources: [.copy("input.txt")]),
            .target(
                    name: "Day2",
                    resources: [.copy("input.txt")]),
            .target(
                    name: "Day3",
                    resources: [.copy("input.txt")]),
            .target(
                    name: "Day4",
                    resources: [.copy("input.txt")]),
            .target(
                    name: "Day5",
                    resources: [.copy("input.txt")]),
            .target(
                    name: "Day6",
                    resources: [.copy("input.txt")]),
            .target(
                    name: "Day7",
                    resources: [.copy("input.txt")]),
        ]
)
