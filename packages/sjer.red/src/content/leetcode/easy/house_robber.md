---
title: "House Robber"
date: 2024-07-21Z-0700
leetcode: true
---

## Problem

You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed, the only constraint stopping you from robbing each of them is that adjacent houses have security systems connected and it will automatically contact the police if two adjacent houses were broken into on the same night.

Given an integer array nums representing the amount of money of each house, return the maximum amount of money you can rob tonight without alerting the police.

Example 1:

```text
Input: nums = [1,2,3,1]
Output: 4
Explanation: Rob house 1 (money = 1) and then rob house 3 (money = 3).
Total amount you can rob = 1 + 3 = 4.
```

Example 2:

```text
Input: nums = [2,7,9,3,1]
Output: 12
Explanation: Rob house 1 (money = 2), rob house 3 (money = 9) and rob house 5 (money = 1).
Total amount you can rob = 2 + 9 + 1 = 12.
```

Constraints:

- 1 <= nums.length <= 100
- 0 <= nums[i] <= 400

## Solution

Recursion on this one feels a little more natural.

First draft, without memoization.

```java
class Solution {
    public int rob(int[] nums) {
        return rob(nums, nums.length - 1);
    }

    public int rob(int[] nums, int n) {
        if (n < 0) {
            // we're past the start of the array
            return 0;
        }
        var yes = nums[n] + rob(nums, n - 2);
        var no = rob(nums, n - 1);
        return Math.max(yes, no);
    }
}
```

Adding memoization:

```java
class Solution {
    public int rob(int[] nums) {
        var m = new int[nums.length];
        for (var i = 0; i < m.length; i++) {
            // sentinel value
            m[i] = -1;
        }
        return rob(nums, nums.length - 1, m);
    }

    public int rob(int[] nums, int n, int[] m) {
        if (n < 0) {
            // we're past the start of the array
            return 0;
        }
        if (m[n] != -1) {
            return m[n];
        }
        var yes = nums[n] + rob(nums, n - 2, m);
        var no = rob(nums, n - 1, m);
        var max = Math.max(yes, no);
        m[n] = max;
        return max;
    }
}
```

A comment brought me to this solution. It seems to be a common pattern with most of the problems I've seen today. I don't quite understand how to come to these solutions myself, though.

<https://leetcode.com/explore/interview/card/top-interview-questions-easy/97/dynamic-programming/576/discuss/156523/From-good-to-great.-How-to-approach-most-of-DP-problems>

```java
class Solution {
    public int rob(int[] nums) {
        var p1 = 0;
        var p2 = 0;
        for (var i : nums) {
            var tmp = p1;
            p1 = Math.max(i + p2, p1);
            p2 = tmp;
        }
        return p1;
    }
}
```
