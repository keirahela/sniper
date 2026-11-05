import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIds, extractPosts, queuePosts, reachedCheckpoint } from '../src/posts.js';

function tweet(id, author, media = [], extra = {}) {
  return {
    rest_id: id,
    core: { user_results: { result: { core: { screen_name: author } } } },
    legacy: { extended_entities: { media }, ...extra },
  };
}
const item = result => ({ content: { itemContent: { tweet_results: { result } } } });
const video = { type: 'video' };
const base = () => ({ lastSeenId: '100', pending: [] });

test('matches watched-account videos; ignores GIFs, photos, and reposts', () => {
  const payload = { instructions: [{ type: 'TimelineAddEntries', entries: [
    item(tweet('101', 'IndieGameJoe', [video])),
    item(tweet('102', 'IndieGameJoe', [{ type: 'animated_gif' }])),
    item(tweet('103', 'IndieGameJoe', [{ type: 'photo' }])),
    item(tweet('104', 'SomeoneElse', [video])),
    item(tweet('105', 'IndieGameJoe', [], { retweeted_status_result: { result: tweet('99', 'SomeoneElse', [video]) } })),
  ] }] };
  const { posts } = extractPosts(payload, 'IndieGameJoe');
  assert.deepEqual(posts.map(post => [post.id, post.hasVideo]), [['101', true], ['102', false], ['103', false]]);
});

test('quote videos are configurable and nested posts are not independent entries', () => {
  const quote = tweet('101', 'IndieGameJoe');
  quote.quoted_status_result = { result: tweet('90', 'IndieGameJoe', [video]) };
  assert.deepEqual(extractPosts(item(quote), 'IndieGameJoe').posts.map(post => [post.id, post.hasVideo]), [['101', true]]);
  assert.equal(extractPosts(item(quote), 'IndieGameJoe', false).posts[0].hasVideo, false);
});

test('supports legacy user names, visibility wrappers, and conversation modules', () => {
  const wrapped = tweet('101', 'IndieGameJoe', [video]);
  wrapped.core.user_results.result = { legacy: { screen_name: 'indiegamejoe' } };
  const payload = { instructions: [{ type: 'TimelineAddEntries', entries: [{ content: { items: [{ item: {
    itemContent: { tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: wrapped } } },
  } }] } }] }] };
  assert.equal(extractPosts(payload, 'IndieGameJoe').posts[0].hasVideo, true);
});

test('an old pinned post does not satisfy catch-up coverage', () => {
  const payload = { instructions: [
    { type: 'TimelinePinEntry', entry: item(tweet('10', 'IndieGameJoe', [video])) },
    { type: 'TimelineAddEntries', entries: [item(tweet('110', 'IndieGameJoe'))] },
  ] };
  const { posts } = extractPosts(payload, 'IndieGameJoe');
  assert.equal(reachedCheckpoint(posts, '100'), false);
  assert.equal(reachedCheckpoint([...posts, { id: '99', pinned: false }], '100'), true);
});

test('first run saves the newest ID and sends no historical alerts', () => {
  assert.deepEqual(queuePosts({ ...base(), lastSeenId: null }, [
    { id: '80', hasVideo: true }, { id: '110', hasVideo: true },
  ]), { lastSeenId: '110', pending: [] });
});

test('keeps snowflake precision, orders alerts, and advances past nonvideo posts', () => {
  assert.equal(compareIds('2000000000000000001', '2000000000000000000'), 1);
  const next = queuePosts(base(), [
    { id: '104', url: 'u104', hasVideo: false },
    { id: '103', url: 'u103', hasVideo: true },
    { id: '101', url: 'u101', hasVideo: true },
    { id: '99', url: 'u99', hasVideo: true },
  ]);
  assert.equal(next.lastSeenId, '104');
  assert.deepEqual(next.pending.map(post => post.id), ['101', '103']);
  assert.deepEqual(queuePosts(next, [{ id: '104', hasVideo: false }]), next);
});

test('does not regress a checkpoint or silently accept an empty scan', () => {
  assert.equal(queuePosts(base(), [{ id: '90', hasVideo: true }]).lastSeenId, '100');
  assert.throws(() => queuePosts(base(), []), /refusing to advance/);
});

test('unrecognized payloads and tombstones do not become fake posts', () => {
  assert.deepEqual(extractPosts({ tweet_results: { result: { __typename: 'TweetTombstone' } } }, 'IndieGameJoe').posts, []);
});
