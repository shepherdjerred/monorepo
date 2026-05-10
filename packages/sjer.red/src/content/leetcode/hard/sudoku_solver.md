---
title: "Sudoku Solver"
date: 2024-07-31Z-0700
leetcode: true
---

## Problem

Write a program to solve a Sudoku puzzle by filling the empty cells.

A sudoku solution must satisfy all of the following rules:

- Each of the digits 1-9 must occur exactly once in each row.
- Each of the digits 1-9 must occur exactly once in each column.
- Each of the digits 1-9 must occur exactly once in each of the 9 3x3 sub-boxes of the grid.

The '.' character indicates empty cells.

Example 1:

```text
Input: board = [["5","3",".",".","7",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]
Output: [["5","3","4","6","7","8","9","1","2"],["6","7","2","1","9","5","3","4","8"],["1","9","8","3","4","2","5","6","7"],["8","5","9","7","6","1","4","2","3"],["4","2","6","8","5","3","7","9","1"],["7","1","3","9","2","4","8","5","6"],["9","6","1","5","3","7","2","8","4"],["2","8","7","4","1","9","6","3","5"],["3","4","5","2","8","6","1","7","9"]]
Explanation: The input board is shown above and the only valid solution is shown below:
```

Constraints:

- board.length == 9
- board[i].length == 9
- board\[i][j] is a digit or '.'.
- It is guaranteed that the input board has only one solution.

## Solution

```java
class Solution {
    int rows = 9;
    int cols = 9;

    public void solveSudoku(char[][] board) {
        solve(board, 0, 0);
    }

    // increments row/col as appropriate and calls solve
    public boolean solveNext(char[][] board, int row, int col) {
        if (row == rows - 1 && col == cols - 1) {
            return true;
        }
        if (col >= cols - 1) {
            row += 1;
            col = 0;
        } else {
            col += 1;
        }
        return solve(board, row, col);
    }

    public boolean isValid(char[][] board, int row, int col) {
        // check that the row is valid
        var s = new HashSet<Character>();
        for (int i = 0; i < cols; i++) {
            var c = board[row][i];
            if (c != '.' && s.contains(c)) {
                return false;
            }
            s.add(c);
        }
        s.clear();

        // check that the col is valid
        for (int i = 0; i < rows; i++) {
            var c = board[i][col];
            if (c != '.' && s.contains(c)) {
                return false;
            }
            s.add(c);
        }
        s.clear();

        // check that the square is valid
        var gRow = (int) Math.floor(row / 3);
        var gCol = (int) Math.floor(col / 3);

        for (var r = gRow * 3; r < (gRow * 3) + 3; r++) {
            for (var c = gCol * 3; c < (gCol * 3) + 3; c++) {
                var ch = board[r][c];
                if (ch != '.' && s.contains(ch)) {
                    return false;
                }
                s.add(ch);
            }
        }

        return true;
    }

    public boolean solve(char[][] board, int row, int col) {
        if (board[row][col] == '.') {
            for (var i = 1; i <= 9; i++) {
                board[row][col] = Character.forDigit(i, 10);
                // check if this board state is valid
                // if it is valid, recurse
                if (isValid(board, row, col)) {
                    var result = solveNext(board, row, col);
                    if (result) {
                        return true;
                    }
                }
                // undo
                board[row][col] =  '.';
            }
        } else {
            return solveNext(board, row, col);
        }
        return false;
    }
}
```
