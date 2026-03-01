---
title: "Two Sum"
date: 2026-02-28Z-0700
leetcode: true
---

## Problem

## Solution

This was my first attempt. Reading the problem, I saw that the input was not sorted. We could apply a sort at a cost of `nlogn`.

Once the input is sorted, it becomes a bit easier. We just need to store two points and move them until the two add up to the target. This became a bit tricky since I had to find a way to map the sorted index to the original index. I did this via a find function, though I imagine you could also use a custom sort function that "remembers" the original position of the element. Using the find function is a cost of `2 * n` which is made irrelevant by the cost of the sort (`nlogn`).

The drawback of this approach is that it requires `n` extra space to store a sorted copy of the array.

```typescript
function twoSum(nums: number[], target: number): number[] {
    const copy = [...nums];
    nums.sort((l, r) => l - r);
    let left = 0;
    let right = nums.length - 1;
    while (true) {
        if (left === right) {
            throw "no solution";
        }
        let lv = nums[left];
        let rv = nums[right];
        let total = lv + rv

        if (total > target){
            right -= 1;
            continue;
        } else if (total < target) {
            left += 1;
            continue;
        } else if (total === target) {
            const l_i = copy.findIndex((v) => v === lv)
            copy[l_i] = -1;
            const r_i = copy.findIndex((v) => v === rv)
            return [l_i, r_i]
        }

        throw "not possible";
    }
};
```

Talking to ChatGPT, my implementation is actually rather subpar. It noted that I could easily maintain the index by using a tuple. Also `while true` is not ideal. Here was it's approach

```typescript
function twoSum(nums: number[], target: number): number[] {
  const pairs = nums.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);

  let left = 0;
  let right = pairs.length - 1;

  while (left < right) {
    const sum = pairs[left].v + pairs[right].v;
    if (sum < target) left++;
    else if (sum > target) right--;
    else return [pairs[left].i, pairs[right].i];
  }

  throw new Error("no solution");
}
```

This is much cleaner. It still uses n extra space (to save the indices). But it doesn't require a lookup pass, and it has better control flow.

The suggested solution is a map. I haven't actually read it. How could we use a map here?

I think we could insert all N values into the map. key == value in array, value == count. First pass would be to insert all. Second pass would be to see if map.has(val - target). if (val - target) === val, we would need to check count === 2.
