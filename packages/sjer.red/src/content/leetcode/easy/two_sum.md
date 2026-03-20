---
title: "Two Sum"
date: 2024-06-13Z-0700
leetcode: true
---

## Problem

Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.

Example 1:

```text
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
```

Example 2:

```text
Input: nums = [3,2,4], target = 6
Output: [1,2]
Example 3:

Input: nums = [3,3], target = 6
Output: [0,1]
```

Constraints:

- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
- -10^9 <= target <= 10^9
- Only one valid answer exists.

Follow-up: Can you come up with an algorithm that is less than O(n2) time complexity?

## Solution

Uses O(n) space so that the answer is O(n) time.

I had though there might be a solution using two pointers. It might be more efficient space wise, but it definitely wouldn't beat O(n). The method of searching for a complement is a good trick.

If we wanted to not use extra space, we could sort the array and use something like a binary search when looking for the complement. This would be n \* (log(n)) for the sort + log(n) for the search. Obviously this isn't better than O(n), though.

```java
class Solution {
    public int[] twoSum(int[] nums, int target) {
        var m = new HashMap<Integer, Integer>();

        for (int i = 0; i < nums.length; i++) {
            var complement = target - nums[i];
            if (m.containsKey(complement)) {
                return new int[]{i, m.get(complement)};
            }
            m.put(nums[i], i);
        }

        return null;
    }
}
```
