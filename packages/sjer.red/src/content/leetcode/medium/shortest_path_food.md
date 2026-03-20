---
title: "Shortest Path to Get Food"
date: 2024-08-10Z-0700
leetcode: true
---

## Problem

You are starving and you want to eat food as quickly as possible. You want to find the shortest path to arrive at any food cell.

You are given an m x n character matrix, grid, of these different types of cells:

- '_' is your location. There is exactly one '_' cell.
- '#' is a food cell. There may be multiple food cells.
- 'O' is free space, and you can travel through these cells.
- 'X' is an obstacle, and you cannot travel through these cells.

You can travel to any adjacent cell north, east, south, or west of your current location if there is not an obstacle.

Return the length of the shortest path for you to reach any food cell. If there is no path for you to reach food, return -1.

Example 1:

```text
Input: grid = [["X","X","X","X","X","X"],["X","*","O","O","O","X"],["X","O","O","#","O","X"],["X","X","X","X","X","X"]]
Output: 3
Explanation: It takes 3 steps to reach the food.
```

Example 2:

```text
Input: grid = [["X","X","X","X","X"],["X","*","X","O","X"],["X","O","X","#","X"],["X","X","X","X","X"]]
Output: -1
Explanation: It is not possible to reach the food.
```

Example 3:

```text
Input: grid = [["X","X","X","X","X","X","X","X"],["X","*","O","X","O","#","O","X"],["X","O","O","X","O","O","X","X"],["X","O","O","O","O","#","O","X"],["X","X","X","X","X","X","X","X"]]
Output: 6
Explanation: There can be multiple food cells. It only takes 6 steps to reach the bottom food.
```

Constraints:

- m == grid.length
- n == grid[i].length
- 1 <= m, n <= 200
- grid\[row][col] is '\*', 'X', 'O', or '#'.
- The grid contains exactly one '\*'.

## Solution

```java
class Solution {
    record Coord(int row, int col) {}

    public int getFood(char[][] grid) {
        var q = new LinkedList<Coord>();
        var visited = new boolean[grid.length][grid[0].length];

        // scan through the grid and find the starting pos
        for (var row = 0; row < grid.length; row++) {
            for (var col = 0; col < grid[0].length; col++) {
                if (grid[row][col] == '*') {
                    visited[row][col] = true;
                    q.add(new Coord(row, col));
                    break;
                }
            }
        }

        var distance = 0;

        while (!q.isEmpty()) {
            var size = q.size();
            for (int i = 0; i < size; i++) {
                var curr = q.poll();
                if (grid[curr.row][curr.col] == '#') {
                    return distance;
                }
                // add moves to queue
                var up = new Coord(curr.row + 1, curr.col);
                var down = new Coord(curr.row - 1, curr.col);
                var left = new Coord(curr.row, curr.col - 1);
                var right = new Coord(curr.row, curr.col + 1);

                List.of(up, down, left, right).stream().filter(c -> {
                    return c.row >= 0 && c.row < grid.length && c.col >= 0 && c.col < grid[0].length &&
                      grid[c.row][c.col] != 'X' && visited[c.row][c.col] == false;
                }).forEach(c -> {
                    visited[c.row][c.col] = true;
                    q.add(c);
                });
            }
            distance += 1;
        }

        return -1;
    }
}
```
