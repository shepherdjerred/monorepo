/** Read-only metadata, used only after PinchTab scans the corresponding DOM. */
export const redditBrowserAccessScript = String.raw`(() => {
  const header = document.querySelector('#header-bottom-right .user a');
  const hasContent = document.querySelector('#siteTable, .subreddit-rules-page, .rules-page') !== null;
  const status = performance.getEntriesByType('navigation')[0]?.responseStatus;
  const error = [document.title, ...Array.from(document.querySelectorAll('h1, .interstitial, .error, .error-page')).filter(node => node.getClientRects().length > 0).map(node => node.textContent || ''), ...(hasContent ? [] : [document.body?.innerText || ''])].join(' ').slice(0, 12000);
  const wait = /try again in\s+(\d+)\s+(second|minute|hour)s?/i.exec(error);
  const seconds = wait ? Number(wait[1]) * (wait[2].toLowerCase() === 'hour' ? 3600 : wait[2].toLowerCase() === 'minute' ? 60 : 1) : null;
  return {
    loggedInUsername: header?.textContent?.trim() || null,
    challenge: document.querySelector('#challenge-running, #cf-challenge-running, .g-recaptcha, iframe[src*="captcha"], [data-hcaptcha-sitekey]') !== null || /verify (?:that )?you are human|checking your browser|just a moment|security check|blocked by network security|whoa there,? pardner/i.test(error),
    rateLimited: status === 429 || /too many requests|rate limit exceeded|you've been doing that a lot|you are doing that too much/i.test(error),
    retryAfterSeconds: seconds,
    cursorExpired: /invalid (?:after|cursor)|expired (?:after|cursor)|cursor (?:is )?(?:invalid|expired)/i.test(error),
  };
})()`;

export function redditFeedPageScript(limit: number): string {
  return `(() => {
    const listing = document.querySelector('#siteTable');
    if (!listing) throw new Error('Old Reddit listing did not render');
    const posts = Array.from(listing.querySelectorAll('.thing.link')).slice(0, ${String(limit)}).map(post => {
      const title = post.querySelector('a.title');
      const permalink = post.querySelector('a.comments');
      const link = new URL(permalink?.getAttribute('href') || '', location.href);
      if (!['old.reddit.com', 'www.reddit.com'].includes(link.hostname) || link.protocol !== 'https:') throw new Error('Foreign Reddit post permalink');
      return {
        id: (post.getAttribute('data-fullname') || '').replace(/^t3_/, ''),
        subreddit: post.getAttribute('data-subreddit') || link.pathname.split('/')[2],
        url: 'https://www.reddit.com' + link.pathname,
        author: post.getAttribute('data-author') || post.querySelector('.tagline .author')?.textContent?.trim() || '[deleted]',
        title: title?.textContent?.trim(),
        createdAt: post.querySelector('.tagline time[datetime]')?.getAttribute('datetime'),
        flair: post.querySelector('.linkflairlabel')?.textContent?.trim() || null,
        sticky: post.classList.contains('stickied') || post.querySelector('.stickied-tagline') !== null,
        removed: post.classList.contains('spam') || post.classList.contains('removed'),
        locked: post.classList.contains('locked') || post.querySelector('.locked-tagline') !== null,
        archived: post.classList.contains('archived') || post.querySelector('.archived-tagline') !== null,
        over18: post.classList.contains('over18') || post.querySelector('.nsfw-stamp') !== null,
      };
    });
    const next = listing.querySelector('.next-button a[href]') || document.querySelector('.next-button a[href]');
    return {posts, next: next ? new URL(next.getAttribute('href'), location.href).href : null};
  })()`;
}

export const redditRulesScript = `(() => {
  const rules = document.querySelector('.subreddit-rules-page, .rules-page');
  if (!rules) throw new Error('Old Reddit rules did not render');
  return rules.innerText?.trim() || rules.textContent?.trim() || '';
})()`;

export function redditListingScript(limit: number): string {
  return `(() => {
    const listing = document.querySelector('#siteTable');
    if (!listing) throw new Error('Old Reddit listing did not render');
    return Array.from(listing.querySelectorAll('.thing.link')).slice(0, ${String(limit)}).map(post => {
      const title = post.querySelector('a.title');
      const permalink = post.querySelector('a.comments');
      const link = new URL(permalink?.getAttribute('href') || '', location.href);
      const parts = link.pathname.split('/');
      return {
        id: (post.getAttribute('data-fullname') || '').replace(/^t3_/, ''),
        subreddit: post.getAttribute('data-subreddit') || parts[2],
        url: 'https://www.reddit.com' + link.pathname,
        author: post.getAttribute('data-author') || post.querySelector('.tagline .author')?.textContent?.trim() || '[deleted]',
        title: title?.textContent?.trim(),
        createdAt: post.querySelector('.tagline time[datetime]')?.getAttribute('datetime'),
      };
    });
  })()`;
}

export function redditThreadScript(account: string): string {
  return String.raw`(() => {
    const parts = location.pathname.split('/');
    const id = parts[4];
    const post = document.querySelector('#siteTable .thing.link[data-fullname="t3_' + id + '"]');
    if (!post) throw new Error('Exact old Reddit post did not render');
    const body = post.querySelector('.usertext-body .md')?.textContent?.trim() || '';
    const comments = Array.from(document.querySelectorAll('.commentarea .thing.comment'));
    return {
      id,
      subreddit: post.getAttribute('data-subreddit') || parts[2],
      url: 'https://www.reddit.com/r/' + parts[2] + '/comments/' + id + '/',
      author: post.getAttribute('data-author') || post.querySelector('.tagline .author')?.textContent?.trim() || '[deleted]',
      title: post.querySelector('a.title')?.textContent?.trim(),
      body,
      createdAt: post.querySelector('.tagline time[datetime]')?.getAttribute('datetime'),
      ownReplyIds: comments.filter(comment => (comment.getAttribute('data-author') || comment.querySelector(':scope > .entry .tagline .author')?.textContent || '').trim().toLowerCase() === ${JSON.stringify(account.toLowerCase())}).map(comment => (comment.getAttribute('data-fullname') || '').replace(/^t1_/, '')),
      commentsComplete: document.querySelector('.commentarea .morecomments, .commentarea .morechildren, .commentarea .deepthread') === null,
      removed: post.classList.contains('spam') || /^\[(?:removed|deleted)\]$/i.test(body),
      locked: post.classList.contains('locked') || post.querySelector('.locked-tagline') !== null || document.querySelector('.commentarea .locked-infobar') !== null,
      archived: post.classList.contains('archived') || post.querySelector('.archived-tagline') !== null || document.querySelector('.commentarea .archived-infobar') !== null,
      loggedInUsername: document.querySelector('#header-bottom-right .user a')?.textContent?.trim() || null,
    };
  })()`;
}

export const redditCommentReceiptScript = `(() => {
  const parts = location.pathname.split('/').filter(Boolean);
  const id = parts[5];
  if (!id || !/^[a-z0-9]+$/.test(id)) return null;
  if (location.hostname === 'www.reddit.com') {
    const comment = document.querySelector('shreddit-comment[thingid="t1_' + id + '"]');
    if (!comment) return null;
    return {
      id,
      author: comment.getAttribute('author'),
      body: comment.querySelector(':scope > [slot="comment"]')?.textContent?.trim(),
      createdAt: comment.getAttribute('created-timestamp') || comment.querySelector(':scope time[datetime]')?.getAttribute('datetime'),
      parentId: comment.getAttribute('parentid') || (comment.getAttribute('depth') === '0' ? comment.getAttribute('postid') : null),
    };
  }
  const comment = document.querySelector('.thing.comment[data-fullname="t1_' + id + '"]');
  if (!comment) return null;
  const entry = comment.querySelector(':scope > .entry');
  const parent = comment.parentElement?.closest('.thing');
  return {
    id,
    author: comment.getAttribute('data-author') || entry?.querySelector('.tagline .author')?.textContent?.trim(),
    body: entry?.querySelector('.usertext-body .md')?.textContent?.trim(),
    createdAt: entry?.querySelector('.tagline time[datetime]')?.getAttribute('datetime'),
    parentId: parent?.getAttribute('data-fullname') || 't3_' + parts[3],
  };
})()`;
