// [Sprint 5 · M4] US-48 Find a collaborator by skill — rules with no database (lib/skillSearchRules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_TAGS_MESSAGE, MAX_SEARCH_TAGS, TAG_TOO_LONG_MESSAGE, TOO_MANY_TAGS_MESSAGE,
  matchedSkillsOf, parseSkillTags, rankBySkillMatch, skillTagFilter,
} from '../src/lib/skillSearchRules.js';

test('parseSkillTags: commas or a repeated parameter, trimmed, empty and same-tag-other-case dropped', () => {
  assert.deepEqual(parseSkillTags(undefined), { tags: [], error: null });
  assert.deepEqual(parseSkillTags(''), { tags: [], error: null });
  assert.deepEqual(parseSkillTags(' , ,'), { tags: [], error: null });
  assert.deepEqual(parseSkillTags(' React , css,,REACT '), { tags: ['React', 'css'], error: null });
  assert.deepEqual(parseSkillTags(['react', 'Node.js,css']), { tags: ['react', 'Node.js', 'css'], error: null });
});

test('parseSkillTags: more than 10 tags, a tag over 40 characters, or non-text is refused', () => {
  const ten = Array.from({ length: MAX_SEARCH_TAGS }, (_, i) => `t${i}`);
  assert.equal(parseSkillTags(ten.join(',')).tags.length, 10);
  assert.deepEqual(parseSkillTags([...ten, 'one-more'].join(',')), { tags: [], error: TOO_MANY_TAGS_MESSAGE });
  assert.deepEqual(parseSkillTags('x'.repeat(41)), { tags: [], error: TAG_TOO_LONG_MESSAGE });
  assert.equal(parseSkillTags('x'.repeat(40)).error, null);
  assert.deepEqual(parseSkillTags({ $ne: 'x' }), { tags: [], error: BAD_TAGS_MESSAGE });
  assert.deepEqual(parseSkillTags(['react', { a: 1 }]), { tags: [], error: BAD_TAGS_MESSAGE });
});

test('skillTagFilter: whole tag, any case, special characters are literal', () => {
  const [pattern] = skillTagFilter(['react']).$in;
  assert.ok(pattern.test('React'));
  assert.ok(pattern.test('REACT'));
  assert.ok(!pattern.test('React Native'), 'a whole tag, not part of one');
  assert.ok(!pattern.test('preact'));

  const [cpp] = skillTagFilter(['C++']).$in;
  assert.ok(cpp.test('c++'));
  assert.ok(!cpp.test('ccc'), '+ is not a regex operator here');
  const [dot] = skillTagFilter(['node.js']).$in;
  assert.ok(!dot.test('nodexjs'));
});

test('matchedSkillsOf: the user\'s own spelling, counted once', () => {
  assert.deepEqual(matchedSkillsOf(['React', 'CSS', 'Figma'], ['css', 'react', 'go']), ['React', 'CSS']);
  assert.deepEqual(matchedSkillsOf(['React', 'react'], ['REACT']), ['React']);
  assert.deepEqual(matchedSkillsOf(undefined, ['react']), []);
});

test('AC1: rankBySkillMatch orders by number of matching tags, then by name; non-matches are dropped', () => {
  const users = [
    { name: 'zoe', username: 'zoe', skills: ['React'] },
    { name: 'Cara', username: 'cara', skills: ['react', 'css', 'node.js'] },
    { name: 'Ben', username: 'ben', skills: ['Figma'] },
    { name: 'Amit', username: 'amit', skills: ['CSS', 'React'] },
    { name: 'adam', username: 'adam', skills: ['CSS'] },
  ];
  const ranked = rankBySkillMatch(users, ['React', 'CSS', 'Node.js']);
  assert.deepEqual(ranked.map((u) => u.name), ['Cara', 'Amit', 'adam', 'zoe']);
  assert.deepEqual(ranked.map((u) => u.matchCount), [3, 2, 1, 1]);
  assert.deepEqual(ranked[1].matchedSkills, ['CSS', 'React']);
  assert.equal(users[0].matchCount, undefined, 'the input objects are not changed');
});
