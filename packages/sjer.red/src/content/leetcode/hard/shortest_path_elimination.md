---
title: "Shortest Path in a Grid with Obstacles Elimination"
date: 2024-08-11Z-0700
leetcode: true
---

## Problem

You are given an m x n integer matrix grid where each cell is either 0 (empty) or 1 (obstacle). You can move up, down, left, or right from and to an empty cell in one step.

Return the minimum number of steps to walk from the upper left corner (0, 0) to the lower right corner (m - 1, n - 1) given that you can eliminate at most k obstacles. If it is not possible to find such walk return -1.

Example 1:

```text
Input: grid = [[0,0,0],[1,1,0],[0,0,0],[0,1,1],[0,0,0]], k = 1
Output: 6
Explanation:
The shortest path without eliminating any obstacle is 10.
The shortest path with one obstacle elimination at position (3,2) is 6. Such path is (0,0) -> (0,1) -> (0,2) -> (1,2) -> (2,2) -> (3,2) -> (4,2).
```

Example 2:

```text
Input: grid = [[0,1,1],[1,1,1],[1,0,0]], k = 1
Output: -1
Explanation: We need to eliminate at least two obstacles to find such a walk.
```

Constraints:

- m == grid.length
- n == grid[i].length
- 1 <= m, n <= 40
- 1 <= k <= m \* n
- grid\[i][j] is either 0 or 1.
- grid\[0][0] == grid\[m - 1][n - 1] == 0

## Solution

I got this on my **first try** (after fixing a tiny validation bug)!

```java
class Solution {
    record Coord(int row, int col) {
    }

    public int shortestPath(int[][] grid, int k) {
        var rows = grid.length;
        var cols = grid[0].length;
        // bfs
        // visited should store how many obstacles we can still eliminate
        var visited = new int[rows][cols];
        var steps = 0;
        var q = new LinkedList<Coord>();

        for (var v : visited) {
            Arrays.fill(v, -1);
        }

        q.add(new Coord(0, 0));
        visited[0][0] = k;

        while (!q.isEmpty()) {
            var size = q.size();
            for (var i = 0; i < size; i++) {
                var curr = q.poll();
                var remaining = visited[curr.row][curr.col];

                // check if this is the dest
                if (curr.row == rows - 1 && curr.col == cols - 1) {
                    return steps;
                }

                // try every direction
                var left = new Coord(curr.row, curr.col - 1);
                var right = new Coord(curr.row, curr.col + 1);
                var up = new Coord(curr.row + 1, curr.col);
                var down = new Coord(curr.row - 1, curr.col);
                List.of(left, right, up, down).stream().filter((c) -> {
                    // validate coordinates
                    if (c.row >= 0 && c.row < rows && c.col >= 0 && c.col < cols) {
                        // if this is an obstacle, see if we can still go over more
                        if (grid[c.row][c.col] == 1 && remaining <= 0) {
                            return false;
                        }
                        // only add this path if it's better than what we've seen before
                        return visited[c.row][c.col] < remaining;
                    }
                    return false;
                }).forEach((c) -> {
                    var r = remaining;
                    // if this is an obstacle, decrement
                    if (grid[c.row][c.col] == 1) {
                        r -= 1;
                    }
                    // this should only apply on the first iteration
                    visited[c.row][c.col] = Math.max(visited[c.row][c.col], r);
                    q.add(c);
                });
            }
            size += 1;
            steps += 1;
        }

        return -1;
    }
}
```
