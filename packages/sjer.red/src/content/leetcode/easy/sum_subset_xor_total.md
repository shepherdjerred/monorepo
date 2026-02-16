---
title: "Sum of All Subset XOR Totals"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

The XOR total of an array is defined as the bitwise XOR of all its elements, or 0 if the array is empty.

- For example, the XOR total of the array [2,5,6] is 2 XOR 5 XOR 6 = 1.

Given an array nums, return the sum of all XOR totals for every subset of nums.

Note: Subsets with the same elements should be counted multiple times.

An array a is a subset of an array b if a can be obtained from b by deleting some (possibly zero) elements of b.

Example 1:

```text
Input: nums = [1,3]
Output: 6
Explanation: The 4 subsets of [1,3] are:

- The empty subset has an XOR total of 0.
- [1] has an XOR total of 1.
- [3] has an XOR total of 3.
- [1,3] has an XOR total of 1 XOR 3 = 2.
0 + 1 + 3 + 2 = 6
```

Example 2:

```text
Input: nums = [5,1,6]
Output: 28
Explanation: The 8 subsets of [5,1,6] are:

- The empty subset has an XOR total of 0.
- [5] has an XOR total of 5.
- [1] has an XOR total of 1.
- [6] has an XOR total of 6.
- [5,1] has an XOR total of 5 XOR 1 = 4.
- [5,6] has an XOR total of 5 XOR 6 = 3.
- [1,6] has an XOR total of 1 XOR 6 = 7.
- [5,1,6] has an XOR total of 5 XOR 1 XOR 6 = 2.
0 + 5 + 1 + 6 + 4 + 3 + 7 + 2 = 28
```

Example 3:

```text
Input: nums = [3,4,5,6,7,8]
Output: 480
Explanation: The sum of all XOR totals for every subset is 480.
```

Constraints:

- 1 <= nums.length <= 12
- 1 <= nums[i] <= 20

## Solution

```java
class Solution {
    public int subsetXORSum(int[] nums) {
        var subsets = new ArrayList<List<Integer>>();
        subsets(nums, 0, List.of(), subsets);
        // for each subset, compute the XOR total
        return subsets.stream().map((subset) -> {
            var total = 0;
            for (var i : subset) {
                total = total ^ i;
            }
            return total;
        }).reduce(Integer::sum).orElseThrow();
    }

    public void subsets(int[] nums, int i, List<Integer> curr, List<List<Integer>> subsets) {
        // at each step, we can choose to add nums[i] to curr or not
        if (i == nums.length) {
            // for sanity
            if (!curr.isEmpty()) {
                subsets.add(curr);
            }
            return;
        }
        // choose to not add
        subsets(nums, i + 1, curr, subsets);
        // choose to add
        var copy = new ArrayList<>(curr);
        copy.add(nums[i]);
        subsets(nums, i + 1, copy, subsets);
    }
}
```
