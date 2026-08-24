/**
 * @typedef {object} ParallelLink
 * @property {string} source
 * @property {string} target
 * @property {number} parallelOffset
 */

/**
 * Assign symmetric curve offsets without collapsing oppositely directed links.
 *
 * The curve renderer derives its perpendicular vector from source to target.
 * Reversing a link reverses that vector, so its offset must also be reversed to
 * keep parallel links on separate sides of the shared canonical pair.
 *
 * @param {ParallelLink[]} links
 */
export function assignParallelOffsets(links) {
  /** @type {Map<string, ParallelLink[]>} */
  const linksByPair = new Map();

  for (const link of links) {
    const pair = [link.source, link.target].sort();
    const pairKey = pair.join("\u0000");
    const parallelLinks = linksByPair.get(pairKey);
    if (parallelLinks === undefined) {
      linksByPair.set(pairKey, [link]);
    } else {
      parallelLinks.push(link);
    }
  }

  for (const parallelLinks of linksByPair.values()) {
    const middle = (parallelLinks.length - 1) / 2;
    parallelLinks.forEach((link, index) => {
      const canonicalSource = [link.source, link.target].sort()[0];
      const orientation = link.source === canonicalSource ? 1 : -1;
      link.parallelOffset = (index - middle) * orientation;
    });
  }
}
