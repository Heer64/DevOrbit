// Sprint 2 Pair D: the mock must follow the same contract as the real status API,
// so the board behaves the same before and after switching to the backend.
import { describe, expect, it, vi } from 'vitest';
import { mockTaskApi } from './taskMock';

let counter = 0;
const freshProject = () => `mock-project-${(counter += 1)}`;

describe('mockTaskApi Kanban contract', () => {
  it('seed tasks have a version and include a Blocked task', async () => {
    const { tasks } = await mockTaskApi.list(freshProject());
    expect(tasks.every((task) => task.version === 0)).toBe(true);
    expect(tasks.some((task) => task.status === 'Blocked')).toBe(true);
  });

  it('updateStatus saves and bumps the version', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    const { task: saved } = await mockTaskApi.updateStatus(pid, task._id, { status: 'Blocked', version: 0 });
    expect(saved).toMatchObject({ status: 'Blocked', version: 1 });
    expect((await mockTaskApi.get(pid, task._id)).task.version).toBe(1);
  });

  it('a stale version is rejected with 409 { message, task }', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    const first = task.status === 'In progress' ? 'To do' : 'In progress';
    await mockTaskApi.updateStatus(pid, task._id, { status: first, version: 0 });
    const error = await mockTaskApi.updateStatus(pid, task._id, { status: 'Blocked', version: 0 }).catch((e) => e);
    expect(error.status).toBe(409);
    expect(error.response.data.message).toBe('This task was changed by someone else.');
    expect(error.response.data.task).toMatchObject({ status: first, version: 1 });
  });

  it('rejects a missing version or unknown status', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    expect((await mockTaskApi.updateStatus(pid, task._id, { status: 'Done' }).catch((e) => e)).status).toBe(400);
    expect((await mockTaskApi.updateStatus(pid, task._id, { status: 'Later', version: 0 }).catch((e) => e)).status).toBe(400);
  });

  it('the general update also bumps the version', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    const { task: saved } = await mockTaskApi.update(pid, task._id, { title: 'Renamed in mock' });
    expect(saved.version).toBe(1);
  });

  it('subscribe receives task:updated events and can unsubscribe', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    const callback = vi.fn();
    const stop = mockTaskApi.subscribe(pid, callback);

    await mockTaskApi.updateStatus(pid, task._id, { status: 'In progress', version: 0 });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(expect.objectContaining({ _id: task._id, version: 1 })));

    stop();
    callback.mockClear();
    await mockTaskApi.updateStatus(pid, task._id, { status: 'Blocked', version: 1 });
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(callback).not.toHaveBeenCalled();
  });

  it('the "conflict" demo switch produces a 409 once', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    localStorage.setItem('devorbit_mock_move', 'conflict');
    const error = await mockTaskApi.updateStatus(pid, task._id, { status: 'Done', version: 0 }).catch((e) => e);
    expect(error.status).toBe(409);
    expect(error.response.data.task.status).not.toBe('Done');
    expect(localStorage.getItem('devorbit_mock_move')).toBeNull();
  });

  it('the "reject" demo switch fails the move with 500', async () => {
    const pid = freshProject();
    const [task] = (await mockTaskApi.list(pid)).tasks;
    localStorage.setItem('devorbit_mock_move', 'reject');
    expect((await mockTaskApi.updateStatus(pid, task._id, { status: 'Done', version: 0 }).catch((e) => e)).status).toBe(500);
  });
});
