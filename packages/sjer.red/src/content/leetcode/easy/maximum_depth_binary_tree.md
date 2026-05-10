---
title: "Maximum Depth of Binary Tree"
date: 2024-07-18Z-0700
leetcode: true
---

## Problem

Given the root of a binary tree, return its maximum depth.

A binary tree's maximum depth is the number of nodes along the longest path from the root node down to the farthest leaf node.

Example 1:

```text
Input: root = [3,9,20,null,null,15,7]
Output: 3
```

Example 2:

```text
Input: root = [1,null,2]
Output: 2
```

Constraints:

- The number of nodes in the tree is in the range [0, 104].
- -100 <= Node.val <= 100

## Solution

There is a simple recursive solution to this. Essentially, I will have a recursive function that takes a `depth` parameter and a node. It will call itself on the left and right nodes of the current node, and add one to the current depth. It will then return the value that is higher. If the node is null, it'll return the depth passed in.

Time complexity: O(n)
Space complexity: O(n)

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
    public int maxDepth(TreeNode root) {
        return maxDepth(root, 0);
    }

    public int maxDepth(TreeNode root, int depth) {
        if (root == null) {
            return depth;
        }
        return Math.max(maxDepth(root.left, depth + 1), maxDepth(root.right, depth + 1));
    }
}
```
