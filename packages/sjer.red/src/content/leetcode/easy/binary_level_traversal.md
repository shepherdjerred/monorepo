---
title: "Binary Tree Level Order Traversal"
date: 2024-07-19Z-0700
leetcode: true
---

## Problem

Given the root of a binary tree, return the level order traversal of its nodes' values. (i.e., from left to right, level by level).

Example 1:

```text
Input: root = [3,9,20,null,null,15,7]
Output: [[3],[9,20],[15,7]]
```

Example 2:

```text
Input: root = [1]
Output: [[1]]
```

Example 3:

```text
Input: root = []
Output: []
```

Constraints:

- The number of nodes in the tree is in the range [0, 2000].
- -1000 <= Node.val <= 1000

## Solution

We will need to traverse the binary tree and keep a depth counter. This is pretty easy to solve with a HashMap though it sounds like it'd be inefficient.

Looking through the answers it seems like a queue makes this problem much easier to solve. I don't think I could've solved this one without looking at answers.

We can solve this with BFS.

- Create a queue `q`.
- Add `root` to `q`.
- Set `depth = 1`.
- Set `output = []`.
- For every item `i` currently in `q`:
  - Add children of `i` to `q` (do not loop over these newly added items).
  - Create a new array `a`.
  - Increment `depth`.
  - Put the values in `a` into `q`.
- Continue the above until `q` is empty.

This solution is O(n) time, O(n) space.

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
    public List<List<Integer>> levelOrder(TreeNode root) {
        var output = new ArrayList<List<Integer>>();
        Queue<TreeNode> q = new LinkedList<TreeNode>();
        q.add(root);
        while (!q.isEmpty()) {
            var depth = 0;
            // capture the current size
            var size = q.size();
            // create a list to store the items at the current level
            var l = new ArrayList<Integer>();
            // go over everything at the current level
            for (var i = 0; i < size; i++) {
                // add this item to the list
                var item = q.remove();
                if (item == null) {
                    continue;
                }
                l.add(item.val);
                // add their children to the queue
                q.add(item.left);
                q.add(item.right);
            }
            if (!l.isEmpty()) {
                output.add(l);
            }
        }
        return output;
    }
}
```
