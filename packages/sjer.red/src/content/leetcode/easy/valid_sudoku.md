---
title: "Valid Sudoku"
date: 2024-06-14Z-0700
leetcode: true
---

## Problem

Determine if a 9 x 9 Sudoku board is valid. Only the filled cells need to be validated according to the following rules:

- Each row must contain the digits 1-9 without repetition.
- Each column must contain the digits 1-9 without repetition.
- Each of the nine 3 x 3 sub-boxes of the grid must contain the digits 1-9 without repetition.

Note:

- A Sudoku board (partially filled) could be valid but is not necessarily solvable.
- Only the filled cells need to be validated according to the mentioned rules.

Example 1:

```text
Input: board =
[["5","3",".",".","7",".",".",".","."]
,["6",".",".","1","9","5",".",".","."]
,[".","9","8",".",".",".",".","6","."]
,["8",".",".",".","6",".",".",".","3"]
,["4",".",".","8",".","3",".",".","1"]
,["7",".",".",".","2",".",".",".","6"]
,[".","6",".",".",".",".","2","8","."]
,[".",".",".","4","1","9",".",".","5"]
,[".",".",".",".","8",".",".","7","9"]]
Output: true
```

Example 2:

```text
Input: board =
[["8","3",".",".","7",".",".",".","."]
,["6",".",".","1","9","5",".",".","."]
,[".","9","8",".",".",".",".","6","."]
,["8",".",".",".","6",".",".",".","3"]
,["4",".",".","8",".","3",".",".","1"]
,["7",".",".",".","2",".",".",".","6"]
,[".","6",".",".",".",".","2","8","."]
,[".",".",".","4","1","9",".",".","5"]
,[".",".",".",".","8",".",".","7","9"]]
Output: false
Explanation: Same as Example 1, except with the 5 in the top left corner being modified to 8. Since there are two 8's in the top left 3x3 sub-box, it is invalid.
```

Constraints:

- board.length == 9
- board[i].length == 9
- board[i]\[j] is a digit 1-9 or '.'.

## Solution

The algorithm is simple. The difficulty with this problem is managing complexity.

There are more terse solutions, but they are harder to understand. I think my solution is easy to understand, though it could be simplified e.g. by using Java streams or the standard library's `unique` function.

Because the size of the input is fixed to a 9x9 board, the time and space complexity is O(1).

```java
class Solution {
    public boolean isValidSudoku(char[][] board) {
        // check rows
        for (var i = 0; i < board.length; i++) {
            if (unique(board[i])) {
                continue;
            } else {
                return false;
            }
        }

        // check cols
        for (var i = 0; i < board.length; i++) {
            var col = col(board, i);
            if (unique(col)) {
                continue;
            } else {
                return false;
            }
        }

        // check blocks
        for (var x = 0; x < 3; x++) {
            for (var y = 0; y < 3; y++) {
              var block = block(board, x, y);
              if (unique(block)) {
                continue;
              } else {
                  return false;
              }
            }
        }

        return true;
    }

    // convert a block into an array
    public char[] block(char[][] board, int x, int y) {
        var offsetX = x * 3;
        var offsetY = y * 3;

        var boundX = offsetX + 3;
        var boundY = offsetY + 3;

        var block = new char[9];
        var i = 0;

        for (var cx = offsetX; cx < boundX; cx++) {
            for (var cy = offsetY; cy < boundY; cy++) {
                block[i] = board[cx][cy];
                i += 1;
            }
        }

        return block;
    }

    // convert a col into an array
    public char[] col(char[][] board, int n) {
        var col = new char[board.length];
        // iterate over every row, grab the nth char
        for (var i = 0; i < board.length; i++) {
            col[i] = board[i][n];
        }
        return col;
    }

    public boolean unique(char[] c) {
        var set = new HashSet<Character>();
        for (var i = 0; i < c.length; i++) {
            if (c[i] == '.') {
                continue;
            }
            if (set.contains(c[i])) {
                return false;
            }
            set.add(c[i]);
        }
        return true;
    }
}
```
