---
title: "Rotate Array"
date: 2024-06-11Z-0700
leetcode: true
---

## Problem

Given an integer array nums, rotate the array to the right by k steps, where k is non-negative.

Example 1:

```text
Input: nums = [1,2,3,4,5,6,7], k = 3
Output: [5,6,7,1,2,3,4]
Explanation:
rotate 1 steps to the right: [7,1,2,3,4,5,6]
rotate 2 steps to the right: [6,7,1,2,3,4,5]
rotate 3 steps to the right: [5,6,7,1,2,3,4]
```

Example 2:

```text
Input: nums = [-1,-100,3,99], k = 2
Output: [3,99,-1,-100]
Explanation:
rotate 1 steps to the right: [99,-1,-100,3]
rotate 2 steps to the right: [3,99,-1,-100]
```

Constraints:

- 1 <= nums.length <= 10^5
- -2^31 <= nums[i] <= 2^31 - 1
- 0 <= k <= 10^5

Follow up:

- Try to come up with as many solutions as you can. There are at least three different ways to solve this problem.
- Could you do it in-place with O(1) extra space?

## Solution

This can be done with O(1) space using some rotation tricks. I suspect there is also a way to do this mathematically, but the algorithm was getting a little complicated.

```java
class Solution {
    // this solution uses o(n) storage.
    public void rotate(int[] nums, int k) {
        // simplifies overflows
        k = k % nums.length;
        int[] copy = new int[nums.length];
        for (int i = 0; i < nums.length; i++) {
            copy[i] = nums[i];
        }
        for (int i = 0; i < nums.length; i++) {
            // determine the write target
            var target = (i + k) % nums.length;
            nums[target] = copy[i];
        }
    }
}
```

### Using `reverse`

```java
class Solution {
    public void rotate(int[] nums, int k) {
        k = k % nums.length;
        reverse(nums, 0, nums.length - 1);
        reverse(nums, k, nums.length - 1);
        reverse(nums, 0, k - 1);
    }

    public void reverse(int[] nums, int start, int end) {
        while (start < end) {
            var tmp = nums[start];
            nums[start] = nums[end];
            nums[end] = tmp;
            start += 1;
            end -= 1;
        }
    }
}
```
