// X's website response format is undocumented. Keep its interpretation isolated here.
export const compareIds = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

function unwrap(result) {
  return result?.tweet ?? result;
}

function mediaOn(tweet) {
  return tweet?.legacy?.extended_entities?.media ?? tweet?.legacy?.entities?.media ?? [];
}

function hasVideo(tweet, includeQuotes, depth = 0) {
  if (mediaOn(tweet).some(media => media.type === 'video')) return true;
  if (!includeQuotes || depth >= 5) return false;
  const quote = unwrap(tweet?.quoted_status_result?.result ?? tweet?.legacy?.quoted_status_result?.result);
  return quote ? hasVideo(quote, true, depth + 1) : false;
}

export function extractPosts(payload, username, includeQuotedVideos = true) {
  const posts = new Map();
  let recognizedTweets = 0;
  function visit(value, pinned = false) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, pinned);
      return;
    }
    pinned ||= value.type === 'TimelinePinEntry';
    if (value.tweet_results) {
      const tweet = unwrap(value.tweet_results.result);
      const user = tweet?.core?.user_results?.result;
      const author = user?.core?.screen_name ?? user?.legacy?.screen_name;
      const id = tweet?.rest_id ?? tweet?.legacy?.id_str;
      if (typeof author === 'string' && /^\d+$/.test(id || '') && tweet?.legacy) {
        recognizedTweets++;
        if (author.toLowerCase() === username.toLowerCase() && !tweet.legacy.retweeted_status_result && !tweet.retweeted_status_result) {
          const previous = posts.get(id);
          posts.set(id, {
            id,
            url: `https://x.com/${username}/status/${id}`,
            hasVideo: hasVideo(tweet, includeQuotedVideos),
            pinned: pinned && previous?.pinned !== false,
          });
        }
      }
      // Quoted/reposted tweets are content of this entry, not separate timeline entries.
      return;
    }
    for (const child of Object.values(value)) visit(child, pinned);
  }
  visit(payload);
  return { posts: [...posts.values()], recognizedTweets };
}

export function reachedCheckpoint(posts, sinceId) {
  return sinceId !== null && posts.some(post => !post.pinned && compareIds(post.id, sinceId) <= 0);
}

export function queuePosts(state, posts) {
  if (!posts.length) throw new Error('No posts were readable; refusing to advance the checkpoint.');
  const ordered = [...posts].sort((a, b) => compareIds(a.id, b.id));
  const newest = ordered.at(-1).id;
  if (state.lastSeenId === null) {
    return { ...state, lastSeenId: newest }; // First run establishes a baseline, without old alerts.
  }
  const pendingIds = new Set(state.pending.map(post => post.id));
  const newVideos = ordered.filter(post => compareIds(post.id, state.lastSeenId) > 0 && post.hasVideo && !pendingIds.has(post.id));
  return {
    ...state,
    lastSeenId: compareIds(newest, state.lastSeenId) > 0 ? newest : state.lastSeenId,
    pending: [...state.pending, ...newVideos.map(({ id, url }) => ({ id, url }))],
  };
}
