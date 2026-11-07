// [Sprint 5 · M7] US-52 AC2/AC3, NFR-13, NFR-14: the vote engine's race logic, without MongoDB.
//
// The engine is given small in-memory stand-ins for the Post and PostVote models. Every call
// waits a random number of event-loop turns before it reads or writes, so hundreds of votes
// really interleave in different orders. Each single call is atomic, like one MongoDB operation.
// The real-database version of these checks is in postVotes.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVoteEngine } from '../src/lib/voteEngine.js';

// Small seeded random generator, so a failing order can be replayed with the same seed.
function randomFrom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

function fakeModels(seed = 1) {
  const random = randomFrom(seed);
  const turns = () => new Promise((resolve) => {
    let left = Math.floor(random() * 4);
    const step = () => (left-- <= 0 ? resolve() : setImmediate(step));
    step();
  });

  const posts = new Map();
  let votes = [];
  let nextId = 1;
  const same = (a, b) => String(a) === String(b);
  const matches = (row, filter) => Object.entries(filter).every(([key, want]) => {
    if (want && typeof want === 'object' && Array.isArray(want.$in)) return want.$in.some((item) => same(row[key], item));
    return same(row[key], want);
  });
  const query = (rows) => ({ lean: async () => { await turns(); return rows(); } });

  const Post = {
    async updateOne(filter, update) {
      await turns();
      const post = posts.get(String(filter._id));
      if (!post) return { matchedCount: 0, modifiedCount: 0 };
      for (const [key, by] of Object.entries(update.$inc || {})) post[key] += by;
      Object.assign(post, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };

  const PostVote = {
    findOne: (filter) => query(() => {
      const row = votes.find((item) => matches(item, filter));
      return row ? { ...row } : null;
    }),
    find: (filter) => query(() => votes.filter((item) => matches(item, filter)).map((row) => ({ ...row }))),
    async create(doc) {
      await turns();
      if (votes.some((row) => same(row.post, doc.post) && same(row.user, doc.user))) {
        const error = new Error('E11000 duplicate key error');
        error.code = 11000;
        throw error;
      }
      const row = { _id: `v${nextId++}`, ...doc };
      votes.push(row);
      return { ...row };
    },
    async updateOne(filter, update) {
      await turns();
      const row = votes.find((item) => matches(item, filter));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      const changed = Object.entries(update.$set).some(([key, value]) => row[key] !== value);
      Object.assign(row, update.$set);
      return { matchedCount: 1, modifiedCount: changed ? 1 : 0 };
    },
    async deleteOne(filter) {
      await turns();
      const index = votes.findIndex((item) => matches(item, filter));
      if (index === -1) return { deletedCount: 0 };
      votes.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      await turns();
      const before = votes.length;
      votes = votes.filter((item) => !matches(item, filter));
      return { deletedCount: before - votes.length };
    },
  };

  return {
    Post,
    PostVote,
    random,
    addPost: (id) => posts.set(id, { upvotes: 0, downvotes: 0, score: 0 }),
    removePost: (id) => posts.delete(id),
    counters: (id) => ({ ...posts.get(id) }),
    rows: () => votes.map((row) => ({ ...row })),
    // What the counters must be, counted from the vote rows.
    expected: (id) => {
      const mine = votes.filter((row) => same(row.post, id));
      const upvotes = mine.filter((row) => row.value === 1).length;
      const downvotes = mine.filter((row) => row.value === -1).length;
      return { upvotes, downvotes, score: upvotes - downvotes };
    },
  };
}

test('one user: vote, repeat, change, retract (FR-24, US-52 AC1/AC2)', async () => {
  const db = fakeModels(7);
  db.addPost('p');
  const { castVote } = makeVoteEngine(db);
  const vote = (value) => castVote({ postId: 'p', userId: 'u', value });

  assert.deepEqual(await vote(1), { outcome: 'cast', previous: 0, value: 1 });
  assert.deepEqual(db.counters('p'), { upvotes: 1, downvotes: 0, score: 1 }); // AC1: by one
  assert.deepEqual(await vote(1), { outcome: 'unchanged', previous: 1, value: 1 });
  assert.deepEqual(db.counters('p'), { upvotes: 1, downvotes: 0, score: 1 }); // AC2: no change
  assert.deepEqual(await vote(-1), { outcome: 'changed', previous: 1, value: -1 });
  assert.deepEqual(db.counters('p'), { upvotes: 0, downvotes: 1, score: -1 });
  assert.deepEqual(await vote(0), { outcome: 'retracted', previous: -1, value: 0 });
  assert.deepEqual(db.counters('p'), { upvotes: 0, downvotes: 0, score: 0 });
  assert.deepEqual(await vote(0), { outcome: 'unchanged', previous: 0, value: 0 });
  assert.equal(db.rows().length, 0);
});

test('AC2 / NFR-13: the same vote sent 50 times at the same moment is counted once', async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const db = fakeModels(seed);
    db.addPost('p');
    const { castVote } = makeVoteEngine(db);
    const results = await Promise.all(Array.from({ length: 50 }, () => castVote({ postId: 'p', userId: 'u', value: 1 })));
    assert.equal(results.filter((result) => result.outcome === 'cast').length, 1, `seed ${seed}`);
    assert.equal(results.filter((result) => result.outcome === 'unchanged').length, 49, `seed ${seed}`);
    assert.deepEqual(db.counters('p'), { upvotes: 1, downvotes: 0, score: 1 }, `seed ${seed}`);
    assert.equal(db.rows().length, 1);
  }
});

test('AC3 / NFR-14: 120 users voting at the same moment are each counted exactly once', async () => {
  for (const seed of [11, 12, 13]) {
    const db = fakeModels(seed);
    db.addPost('p');
    const { castVote } = makeVoteEngine(db);
    await Promise.all(Array.from({ length: 120 }, (_, index) => castVote({ postId: 'p', userId: `u${index}`, value: index < 80 ? 1 : -1 })));
    assert.deepEqual(db.counters('p'), { upvotes: 80, downvotes: 40, score: 40 }, `seed ${seed}`);
    assert.equal(db.rows().length, 120);
  }
});

test('random storms of votes, changes and retracts always leave the counters equal to the votes', async () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const db = fakeModels(seed * 101);
    db.addPost('a');
    db.addPost('b');
    const { castVote, recountPostVotes } = makeVoteEngine(db);
    const values = [1, -1, 0];
    const jobs = Array.from({ length: 150 }, () => castVote({
      postId: db.random() < 0.5 ? 'a' : 'b',
      userId: `u${Math.floor(db.random() * 12)}`, // few users, so the same user often races with themself
      value: values[Math.floor(db.random() * 3)],
    }));
    await Promise.all(jobs);
    for (const id of ['a', 'b']) {
      assert.deepEqual(db.counters(id), db.expected(id), `seed ${seed} post ${id}`);
      assert.deepEqual(await recountPostVotes(id), db.expected(id));
    }
    // FR-24: never more than one vote row per user per post.
    const keys = db.rows().map((row) => `${row.post}:${row.user}`);
    assert.equal(new Set(keys).size, keys.length, `seed ${seed}`);
  }
});

test('a vote that lands while its post is deleted leaves no vote behind', async () => {
  const db = fakeModels(3);
  db.addPost('p');
  const { castVote } = makeVoteEngine(db);
  db.removePost('p');
  assert.deepEqual(await castVote({ postId: 'p', userId: 'u', value: 1 }), { outcome: 'post_gone' });
  assert.equal(db.rows().length, 0);
});

test('attachMyVotes gives each viewer their own vote and 0 elsewhere', async () => {
  const db = fakeModels(5);
  db.addPost('p1');
  db.addPost('p2');
  const { castVote, attachMyVotes, deleteVotesForPost } = makeVoteEngine(db);
  await castVote({ postId: 'p1', userId: 'me', value: -1 });
  await castVote({ postId: 'p2', userId: 'other', value: 1 });
  const views = await attachMyVotes([{ _id: 'p1' }, { _id: 'p2' }], 'me');
  assert.deepEqual(views.map((view) => view.myVote), [-1, 0]);
  assert.deepEqual((await attachMyVotes([{ _id: 'p1' }], null)).map((view) => view.myVote), [0]);
  await deleteVotesForPost('p1');
  assert.deepEqual(db.rows().map((row) => row.post), ['p2']);
});
