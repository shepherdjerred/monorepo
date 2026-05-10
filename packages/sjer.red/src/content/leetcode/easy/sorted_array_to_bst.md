---
title: "Sorted Array to Binary Search Tree"
date: 2024-07-19Z-0700
leetcode: true
---

## Problem

Given an integer array nums where the elements are sorted in ascending order, convert it to a height-balanced binary search tree.

Example 1:

```text
Input: nums = [-10,-3,0,5,9]
Output: [0,-3,9,-10,null,5]
Explanation: [0,-10,5,null,-3,null,9] is also accepted:
```

Example 2:

```text
Input: nums = [1,3]
Output: [3,1]
Explanation: [1,null,3] and [3,1] are both height-balanced BSTs.
```

Constraints:

- 1 <= nums.length <= 104
- -104 <= nums[i] <= 104
- nums is sorted in a strictly increasing order.

## Solution

This feels recursive. Essentially we just want to write a method to deserialize a balanced binary search tree.

To freshen up on terms:

- A binary tree is a tree where each node has at most two children
- A binary search tree is a binary tree where the left child of a node is less the node, and the right child is greater than the node
- A balanced binary search tree is a binary search tree where the different of the height of the children of a node has a difference of at most 1.

How do we pick the root? Take from the middle, bias towards the lower if there are an even number of elements.

So, if we have

- 1, 2, 3, then 2 would be the root.
- 1, 2, then 1 would be the root.

Okay, so how do we make this recursive?

The left child of the root will be the remaining left half of the array. The right child will be the remaining right half. Call the method with the appropriate remaining bit of the array.

Actually this is pretty straightforward! I was pretty intimidated when first reading the problem.

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
    public TreeNode sortedArrayToBST(int[] nums) {
        if (nums.length == 0) {
            return null;
        }
        var middle = nums.length / 2;
        var node = new TreeNode(nums[middle]);

        if (nums.length > 1) {
            var right = Arrays.copyOfRange(nums, middle + 1, nums.length);
            node.right = sortedArrayToBST(right);
        }

        if (middle != 0) {
            var left = Arrays.copyOfRange(nums, 0, middle);
            node.left = sortedArrayToBST(left);
        }

        return node;
    }
}
```
