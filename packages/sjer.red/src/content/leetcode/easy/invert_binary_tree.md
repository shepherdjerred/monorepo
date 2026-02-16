---
title: "Invert Binary Tree"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given the root of a binary tree, invert the tree, and return its root.

Example 1:

```text
Input: root = [4,2,7,1,3,6,9]
Output: [4,7,2,9,6,3,1]
```

Example 2:

```text
Input: root = [2,1,3]
Output: [2,3,1]
```

Example 3:

```text
Input: root = []
Output: []
```

Constraints:

- The number of nodes in the tree is in the range [0, 100].
- -100 <= Node.val <= 100

## Solution

I've studied extensively for this because of that [Homebrew incident](https://x.com/mxcl/status/608682016205344768?lang=en)! This is literally in my Anki deck.

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
    public TreeNode invertTree(TreeNode root) {
        if (root == null) {
            return root;
        }

        var tmp = root.left;
        root.left = invertTree(root.right);
        root.right = invertTree(tmp);

        return root;
    }
}
```
