---
title: "Symmetric Tree"
date: 2024-07-18Z-0700
leetcode: true
---

## Problem

Given the root of a binary tree, check whether it is a mirror of itself (i.e., symmetric around its center).

Example 1:

```text
Input: root = [1,2,2,3,4,4,3]
Output: true
```

Example 2:

```text
Input: root = [1,2,2,null,3,null,3]
Output: false
```

Constraints:

- The number of nodes in the tree is in the range [1, 1000].
- -100 <= Node.val <= 100

Follow up: Could you solve it both recursively and iteratively?

## Solution

This one sounds pretty hard. My first instinct is to transform the tree into some flat structure, e.g. a string, and then do a string comparison.

Alternatively, we could use something like a Stack. Push the nodes on the left side, pop them on the right side. A stack solution can be implemented both iteratively and recursively, which meets the follow-up question.

### Approach 1

Two stacks.

Go through the left and right side of the tree. Push the contents of the tree in a stack. Then empty both stacks checking that popped nodes are equal, and that stacks are both empty at the end.

Notes:

- O(n) runtime, O(n) space
- You'd need to reverse the order on the right side, e.g. pre-order for the left side, post-order for the right side
- You'd need to insert null nodes (e.g. a lack of children)

While implementing the above, I realized maintaining a stack is more work than just doing recursion. Here's a _very_ simple solution:

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
    public boolean isSymmetric(TreeNode root) {
        return isSymmetric(root.left, root.right);
    }

    private boolean isSymmetric(TreeNode left, TreeNode right) {
        if (left == null || right == null) {
            return left == right;
        }
        if (left.val != right.val) {
            return false;
        }
        return isSymmetric(left.left, right.right) && isSymmetric(left.right, right.left);
    }
}
```
