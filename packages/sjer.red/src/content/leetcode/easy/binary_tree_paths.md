---
title: "Binary Tree Paths"
date: 2024-07-28Z-0700Z-0700
leetcode: true
---

## Problem

Given the root of a binary tree, return all root-to-leaf paths in any order.

A leaf is a node with no children.

Example 1:

```text
Input: root = [1,2,3,null,5]
Output: ["1->2->5","1->3"]
```

Example 2:

```text
Input: root = [1]
Output: ["1"]
```

Constraints:

- The number of nodes in the tree is in the range [1, 100].
- -100 <= Node.val <= 100

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
    public List<String> binaryTreePaths(TreeNode root) {
        var answer = new ArrayList<String>();
        solve(root, "", answer);
        return answer;
    }

    public void solve(TreeNode root, String path, List<String> answers) {
        // if this is a leaf, we're done
        if (root.left == null && root.right == null) {
            answers.add(String.format("%s%s", path, root.val));
            return;
        }

        if (root.left != null) {
            solve(root.left, String.format("%s%s->", path, root.val), answers);
        }

        if (root.right != null) {
            solve(root.right, String.format("%s%s->", path, root.val), answers);
        }
    }
}
```
