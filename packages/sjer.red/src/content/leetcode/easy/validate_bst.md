---
title: "Validate Binary Search Tree"
date: 2024-07-18Z-0700
leetcode: true
---

## Problem

Given the root of a binary tree, determine if it is a valid binary search tree (BST).

A valid BST is defined as follows:

- The left subtree of a node contains only nodes with keys less than the node's key.
- The right subtree of a node contains only nodes with keys greater than the node's key.
- Both the left and right subtrees must also be binary search trees.

Example 1:

```text
Input: root = [2,1,3]
Output: true
```

Example 2:

```text
Input: root = [5,1,4,null,null,3,6]
Output: false
Explanation: The root node's value is 5 but its right child's value is 4.
```

Constraints:

- The number of nodes in the tree is in the range [1, 104].
- -231 <= Node.val <= 231 - 1

## Solution

Oh, the joys of easy tree problems!

A binary search tree is a binary tree (a tree where each node has zero to two children) where the left child is always less than the parent, and the right node is always greater than the parent. The tree does _not_ have to be balanced.

Time complexity: O(n)
Space complexity: O(n)

Originally I didn't use an `Optional` type and instead passed in Integer.MIN_VALUE/Integer.MAX_VALUE. This broke on an edge case where the root node was Integer.MAX_VALUE.

Rather than use a sentinal value with some hacky logic, I swapped to an optional type which better models the problem.

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
    public boolean isValidBST(TreeNode root) {
        return isValidBST(root, Optional.empty(), Optional.empty());
    }

    public boolean isValidBST(TreeNode root, Optional<Integer> min, Optional<Integer> max) {
        if (root == null) {
            return true;
        }

        var val = root.val;

        if (min.isPresent() && val <= min.get()) {
            return false;
        }

        if (max.isPresent() && val >= max.get()) {
            return false;
        }

        return isValidBST(root.left, min, Optional.of(val)) && isValidBST(root.right, Optional.of(val), max);
    }
}
```
