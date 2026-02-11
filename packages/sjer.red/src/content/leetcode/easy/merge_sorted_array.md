---
title: "Merge Sorted Array"
date: 2024-07-21Z-0700
leetcode: true
---

## Problem

You are given two integer arrays nums1 and nums2, sorted in non-decreasing order, and two integers m and n, representing the number of elements in nums1 and nums2 respectively.

Merge nums1 and nums2 into a single array sorted in non-decreasing order.

The final sorted array should not be returned by the function, but instead be stored inside the array nums1. To accommodate this, nums1 has a length of m + n, where the first m elements denote the elements that should be merged, and the last n elements are set to 0 and should be ignored. nums2 has a length of n.

Example 1:

```text
Input: nums1 = [1,2,3,0,0,0], m = 3, nums2 = [2,5,6], n = 3
Output: [1,2,2,3,5,6]
Explanation: The arrays we are merging are [1,2,3] and [2,5,6].
The result of the merge is [1,2,2,3,5,6] with the underlined elements coming from nums1.
```

Example 2:

```text
Input: nums1 = [1], m = 1, nums2 = [], n = 0
Output: [1]
Explanation: The arrays we are merging are [1] and [].
The result of the merge is [1].
```

Example 3:

```text
Input: nums1 = [0], m = 0, nums2 = [1], n = 1
Output: [1]
Explanation: The arrays we are merging are [] and [1].
The result of the merge is [1].
Note that because m = 0, there are no elements in nums1. The 0 is only there to ensure the merge result can fit in nums1.
```

Constraints:

- nums1.length == m + n
- nums2.length == n
- 0 <= m, n <= 200
- 1 <= m + n <= 200
- -109 <= nums1[i], nums2[j] <= 109

Follow up: Can you come up with an algorithm that runs in O(m + n) time?

## Solution

This problem has a twist because it has to be done in-place.

We can do it in O(m + n) time by swapping.

e.g.

nums1 = [1,2,3,0,0,0]
nums2 = [2,5,6]

keep a counter for nums1 called p1, nums2 called p2.

check if nums[p1] < nums[p2]. if so increment p1
else, swap nums[p1] with nums[p2]. increment p2

continue until p1 and p2 reach the end of the respective array

no extra space, and done in O(m + n).

---

My approach didn't work for the example `4, 5, 6, 0, 0, 0`, `1, 2, 3`.

The issue is that we would swap 4 -> 2 which breaks the sorting.

We need to sort from the end rather than the beginning to avoid this issue.

```java
class Solution {
    public void merge(int[] nums1, int m, int[] nums2, int n) {
        var cm = m - 1;
        var cn = n - 1;
        var c = m + n - 1;

        // we're essentially starting at the logical ends of nums1 and nums2. we make a local decision and copy the largest value into the slot at c until we've rewritten the entire nums1 array.
        // there's a lot of trickiness with indexes, off-by-one errors, etc.
        while (c >= 0) {
            // check that both arrays are still valid OR that at least nums1 is valid
            if ((cm >= 0 && cn >= 0 && nums1[cm] > nums2[cn]) || (cm >= 0 && cn < 0)) {
                // pull from nums1
                nums1[c] = nums1[cm];
                cm -= 1;
            } else {
                // pull from nums2
                nums1[c] = nums2[cn];
                cn -= 1;
            }
            c -= 1;
        }
    }
}
```
