---
title: "Closest Binary Search Tree Value"
date: 2024-08-08Z-0700
leetcode: true
---

## Problem

Given the root of a binary search tree and a target value, return the value in the BST that is closest to the target. If there are multiple answers, print the smallest.

Example 1:

```text
Input: root = [4,2,5,1,3], target = 3.714286
Output: 4
```

Example 2:

```text
Input: root = [1], target = 4.428571
Output: 1
```

Constraints:

- The number of nodes in the tree is in the range [1, 104].
- 0 <= Node.val <= 109
- -109 <= target <= 109

## Solution

```java
/**
 * Definition for a binary tree node.
 * public class TreeNode {
 *     int val;
 *     TreeNode left;
 *     TreeNode right;
 *     TreeNode() {}
 *     TreeNode(int val) { this.val = val; }
 *     TreeNode(int val, TreeNode left, TreeNode right) {
 *         this.val = val;
 *         this.left = left;
 *         this.right = right;
 *     }
 * }
 */
class Solution {
    public int closestValue(TreeNode root, double target) {
        var closest = root.val;
        while (root != null) {
            var val = root.val;
            var d1 = Math.abs(val - target);
            var d2 = Math.abs(closest - target);
            if (d1 < d2 || (d1 == d2 && val < closest)) {
                closest = val;
            }
            root = target < val ? root.left : root.right;
        }
        return closest;
    }
}
```
