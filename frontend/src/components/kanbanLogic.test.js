import { describe, expect, it } from 'vitest';
import { BOARD_STATUSES, groupByStatus, mergeTask, moveLocally, rollback, versionOf } from './kanbanLogic';

const task = (id, status, version = 0, extra = {}) => ({ _id: id, title: `Task ${id}`, status, version, ...extra });

describe('groupByStatus (US-27)', () => {
  it('has the four columns in board order', () => {
    expect(BOARD_STATUSES).toEqual(['To do', 'In progress', 'Blocked', 'Done']);
    expect(Object.keys(groupByStatus([]))).toEqual(BOARD_STATUSES);
  });

  it('puts every task in the column of its saved status, keeping order', () => {
    const columns = groupByStatus([task('a', 'Done'), task('b', 'Blocked'), task('c', 'To do'), task('d', 'Done')]);
    expect(columns.Done.map((t) => t._id)).toEqual(['a', 'd']);
    expect(columns.Blocked.map((t) => t._id)).toEqual(['b']);
    expect(columns['To do'].map((t) => t._id)).toEqual(['c']);
    expect(columns['In progress']).toEqual([]);
  });

  it('never drops a task with an unknown status', () => {
    expect(groupByStatus([task('x', 'Someday')])['To do'].map((t) => t._id)).toEqual(['x']);
  });
});

describe('versionOf', () => {
  it('treats a missing version as 0', () => {
    expect(versionOf({})).toBe(0);
    expect(versionOf({ version: 4 })).toBe(4);
  });
});

describe('mergeTask', () => {
  const list = [task('a', 'To do', 2), task('b', 'Done', 0)];

  it('server answers win unless we hold something newer', () => {
    expect(mergeTask(list, task('a', 'Done', 3), 'server')[0].status).toBe('Done');
    expect(mergeTask(list, task('a', 'Blocked', 2), 'server')[0].status).toBe('Blocked');
    expect(mergeTask(list, task('a', 'Done', 1), 'server')[0].status).toBe('To do');
  });

  it('live events are applied only when strictly newer (stale events ignored)', () => {
    expect(mergeTask(list, task('a', 'Done', 3), 'remote')[0].status).toBe('Done');
    expect(mergeTask(list, task('a', 'Done', 2), 'remote')).toBe(list);
    expect(mergeTask(list, task('a', 'Done', 1), 'remote')).toBe(list);
  });

  it('adds a task it has not seen yet', () => {
    expect(mergeTask(list, task('z', 'Blocked', 1), 'remote').map((t) => t._id)).toEqual(['z', 'a', 'b']);
  });
});

describe('moveLocally / rollback (US-28)', () => {
  it('moves without touching the version', () => {
    const moved = moveLocally([task('a', 'To do', 5)], 'a', 'Blocked');
    expect(moved[0]).toMatchObject({ status: 'Blocked', version: 5 });
  });

  it('rolls back to the original column', () => {
    const original = task('a', 'To do', 5);
    const moved = moveLocally([original], 'a', 'Done');
    expect(rollback(moved, original)[0].status).toBe('To do');
  });

  it('does not undo a newer live update that arrived meanwhile', () => {
    const original = task('a', 'To do', 5);
    const newer = [task('a', 'Blocked', 6)];
    expect(rollback(newer, original)[0]).toMatchObject({ status: 'Blocked', version: 6 });
  });
});
