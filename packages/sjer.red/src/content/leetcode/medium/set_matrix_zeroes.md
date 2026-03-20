---
title: "Set Matrix Zeroes"
date: 2024-07-31Z-0700
leetcode: true
---

## Problem

Given an m x n integer matrix matrix, if an element is 0, set its entire row and column to 0's.

You must do it in place.

Example 1:

```text
Input: matrix = [[1,1,1],[1,0,1],[1,1,1]]
Output: [[1,0,1],[0,0,0],[1,0,1]]
```

Example 2:

```text
Input: matrix = [[0,1,2,0],[3,4,5,2],[1,3,1,5]]
Output: [[0,0,0,0],[0,4,5,0],[0,3,1,0]]
```

Constraints:

- m == matrix.length
- n == matrix[0].length
- 1 <= m, n <= 200
- -231 <= matrix\[i][j] <= 231 - 1

Follow up:

- A straightforward solution using O(mn) space is probably a bad idea.
- A simple improvement uses O(m + n) space, but still not the best solution.
- Could you devise a constant space solution?

## Solution

```java
class Solution {
    public void setZeroes(int[][] matrix) {
        var rows = matrix.length;
        var cols = matrix[0].length;
        var zeroFirstCol = false;
        var zeroFirstRow = false;

        // mark
        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
                if (matrix[row][0] == 0) {
                    zeroFirstCol = true;
                }

                if (matrix[0][col] == 0) {
                    zeroFirstRow = true;
                }
            }
        }

        for (var row = 1; row < rows; row++) {
            for (var col = 1; col < cols; col++) {
                if (matrix[row][col] == 0) {
                    matrix[row][0] = 0;
                    matrix[0][col] = 0;
                }
            }
        }

        // act
        for (var row = 1; row < rows; row++) {
            for (var col = 1; col < cols; col++) {
                if (matrix[row][0] == 0 || matrix[0][col] == 0) {
                    matrix[row][col] = 0;
                }
            }
        }

        for (var row = 0; row < rows; row++) {
            for (var col = 0; col < cols; col++) {
                if (zeroFirstCol && col == 0) {
                    matrix[row][0] = 0;
                }
                if (zeroFirstRow && row == 0) {
                    matrix[0][col] = 0;
                }
            }
        }
    }
}
```
