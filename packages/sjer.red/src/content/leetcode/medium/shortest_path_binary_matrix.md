---
title: "Shortest Path in Binary Matrix"
date: 2024-07-27Z-0700
leetcode: true
---

## Problem

Given an n x n binary matrix grid, return the length of the shortest clear path in the matrix. If there is no clear path, return -1.

A clear path in a binary matrix is a path from the top-left cell (i.e., (0, 0)) to the bottom-right cell (i.e., (n - 1, n - 1)) such that:

- All the visited cells of the path are 0.
- All the adjacent cells of the path are 8-directionally connected (i.e., they are different and they share an edge or a corner).

The length of a clear path is the number of visited cells of this path.

Example 1:

```text
Input: grid = [[0,1],[1,0]]
Output: 2
```

Example 2:

```text
Input: grid = [[0,0,0],[1,1,0],[1,1,0]]
Output: 4
```

Example 3:

```text
Input: grid = [[1,0,0],[1,1,0],[1,1,0]]
Output: -1
```

Constraints:

- n == grid.length
- n == grid[i].length
- 1 <= n <= 100
- grid\[i][j] is 0 or 1

## Solution

I think that this is a simple search problem. BFS is the simplest solution.

```java
class Solution {
    public int shortestPathBinaryMatrix(int[][] grid) {
        var n = grid.length;
        var m = grid[0].length;

        Queue<int[]> q = new LinkedList<>();
        var visited = new boolean[n][m];
        q.add(new int[]{0, 0, 1});
        visited[0][0] = true;

        // check that the beginning and end are reachable
        if (grid[0][0] == 1 || grid[n - 1][m - 1] == 1) {
            return -1;
        }

        while (!q.isEmpty()) {
            var c = q.poll();

            // we found the end
            if (c[0] == n - 1 && c[1] == m - 1) {
                return c[2];
            }

            // add all adjacent positions that haven't been visited to the queue
            for (var row = -1; row <= 1; row++) {
                for (var col = -1; col <= 1; col++) {
                    var tmp = new int[]{c[0] + row, c[1] + col, c[2] + 1};
                    // bounds check
                    if (tmp[0] < 0 || tmp[0] > n - 1 || tmp[1] < 0 || tmp[1] > m - 1) {
                        continue;
                    }
                    // wall check
                    if (grid[tmp[0]][tmp[1]] == 1) {
                        continue;
                    }
                    // visited check
                    if (visited[tmp[0]][tmp[1]] == true) {
                        continue;
                    }
                    visited[tmp[0]][tmp[1]] = true;
                    q.add(tmp);
                }
            }
        }

        return -1;
    }
}
```
