import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { AlertCircle, Clock3, GripVertical, X } from 'lucide-react';
import { assetUrl } from '../api';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import {
  BOARD_STATUSES,
  COLUMN_LABELS,
  CONFLICT_MESSAGE,
  groupByStatus,
  idOf,
  mergeTask,
  moveLocally,
  rollback,
  versionOf,
} from './kanbanLogic';

/**
 * Kanban board for one project (Sprint 2 Pair D: US-27, US-28).
 *
 * The board does not own the task list; TasksPanel does, so the list view, the board,
 * the edit modal and live updates all show the same data.
 *
 * Props
 *   projectId      project the tasks belong to
 *   tasks          tasks to show (already filtered by the toolbar)
 *   api            taskApi or mockTaskApi; needs updateStatus(), and get() for conflicts
 *   canMove        false for Viewers and non-members: cards cannot be dragged (the API also returns 403)
 *   onUpdateTasks  (updater) => void; updater receives the full task list and returns the new one
 *   onOpenTask     (task) => void when a card is clicked (Pair C's drawer, or the edit modal for now)
 *   onMoved        (task) => void after the server saved a move (refreshes project progress)
 *   members        [{ userId, name }] used only to colour assignee avatars like the list does
 */
export default function KanbanBoard({ projectId, tasks = [], api, canMove = false, onUpdateTasks, onOpenTask, onMoved, members = [] }) {
  const [pending, setPending] = useState(() => new Set());
  const pendingRef = useRef(new Set());
  const [toast, setToast] = useState('');
  const justDragged = useRef(false);

  const columns = useMemo(() => groupByStatus(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((task) => [idOf(task), task])), [tasks]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const setBusy = (id, busy) => {
    if (busy) pendingRef.current.add(id); else pendingRef.current.delete(id);
    setPending(new Set(pendingRef.current));
  };

  const move = useCallback(async (task, toStatus) => {
    const id = idOf(task);
    if (!canMove || !task || !BOARD_STATUSES.includes(toStatus) || task.status === toStatus || pendingRef.current.has(id)) return;

    const original = task;
    setToast('');
    setBusy(id, true);
    // Optimistic: the card is in its new column on the very next render (NFR-5b, < 300 ms).
    onUpdateTasks((list) => moveLocally(list, id, toStatus));

    try {
      const result = await api.updateStatus(projectId, id, { status: toStatus, version: versionOf(original) });
      onUpdateTasks((list) => mergeTask(list, result.task, 'server'));
      onMoved?.(result.task);
    } catch (error) {
      if (error?.status === 409) {
        // Someone else saved first: show their version, never ours.
        let latest = error.response?.data?.task || null;
        if (!latest && api.get) {
          try { latest = (await api.get(projectId, id)).task; } catch { latest = null; }
        }
        onUpdateTasks((list) => (latest ? mergeTask(list, latest, 'server') : rollback(list, original)));
        setToast(CONFLICT_MESSAGE);
      } else {
        onUpdateTasks((list) => rollback(list, original));
        setToast(error?.message ? `${error.message} The task was moved back.` : 'Could not move the task. It was moved back.');
      }
    } finally {
      setBusy(id, false);
    }
  }, [api, canMove, onMoved, onUpdateTasks, projectId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), // a plain click still opens the task
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      // Space picks up / drops a card; Enter is kept for opening it.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    })
  );

  const handleDragStart = () => { justDragged.current = true; };
  const handleDragEnd = ({ active, over }) => {
    setTimeout(() => { justDragged.current = false; }, 0);
    if (!over) return;
    move(byId.get(String(active.id)), String(over.id));
  };
  const handleDragCancel = () => { setTimeout(() => { justDragged.current = false; }, 0); };

  const open = (task) => {
    if (justDragged.current) return;
    onOpenTask?.(task);
  };

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <div className="kanban" aria-label="Task board">
          {BOARD_STATUSES.map((status) => (
            <Column key={status} status={status} count={columns[status].length}>
              {columns[status].map((task) => (
                <Card
                  key={idOf(task)}
                  task={task}
                  canMove={canMove}
                  busy={pending.has(idOf(task))}
                  members={members}
                  onOpen={open}
                  onMove={move}
                />
              ))}
            </Column>
          ))}
        </div>
      </DndContext>

      {toast && (
        <div className="toast kanban-toast" role="alert">
          <AlertCircle size={16} />
          <span>{toast}</span>
          <button type="button" className="task-more" onClick={() => setToast('')} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
    </>
  );
}

function Column({ status, count, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = COLUMN_LABELS[status];
  return (
    <section ref={setNodeRef} className={`kanban-column status-${status.replace(/\s+/g, '-').toLowerCase()} ${isOver ? 'over' : ''}`} aria-label={`${label} column`}>
      <header className="kanban-column-head">
        <span className="kanban-dot" />
        <b>{label}</b>
        <span className="kanban-count" aria-label={`${count} tasks`}>{count}</span>
      </header>
      <div className="kanban-cards">
        {count === 0 ? <p className="kanban-empty">No tasks</p> : children}
      </div>
    </section>
  );
}

function Card({ task, canMove, busy, members, onOpen, onMove }) {
  const id = idOf(task);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled: !canMove || busy });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const assigneeIndex = members.findIndex((member) => idOf(member.userId) === idOf(task.assignee));
  const overdue = isOverdue(task);

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(task);
      return;
    }
    listeners?.onKeyDown?.(event);
  };

  // Keeps the "Move to" menu usable without starting a drag.
  const stop = (event) => event.stopPropagation();

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`kanban-card ${isDragging ? 'dragging' : ''} ${busy ? 'busy' : ''} ${canMove ? 'movable' : ''}`}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(task)}
      aria-label={`${task.title}. ${task.status}.${canMove ? ' Press Space to pick up, Enter to open.' : ' Press Enter to open.'}`}
      data-task-id={id}
      data-status={task.status}
    >
      <div className="kanban-card-top">
        <b className={task.status === 'Done' ? 'crossed' : ''}>{task.title}</b>
        {canMove && <GripVertical size={14} className="kanban-grip" aria-hidden="true" />}
      </div>
      <div className="task-meta">
        <span className={`task-label priority-${(task.priority || 'Medium').toLowerCase()}`}>{task.priority || 'Medium'}</span>
        <span className={overdue ? 'overdue' : ''}><Clock3 size={11} />{formatDue(task.dueDate)}{overdue ? ' · overdue' : ''}</span>
      </div>
      <div className="kanban-card-foot">
        {task.assignee
          ? <Avatar initials={initialsOf(task.assignee.name)} src={assetUrl(task.assignee.avatarUrl)} tone={AVATAR_TONES[Math.max(assigneeIndex, 0) % 4]} small />
          : <span className="avatar small unassigned" title="Unassigned">–</span>}
        {canMove && (
          <select
            className="kanban-move"
            value={task.status}
            disabled={busy}
            aria-label={`Move ${task.title} to`}
            onClick={stop}
            onPointerDown={stop}
            onMouseDown={stop}
            onTouchStart={stop}
            onKeyDown={stop}
            onChange={(event) => onMove(task, event.target.value)}
          >
            {BOARD_STATUSES.map((status) => <option key={status} value={status}>{COLUMN_LABELS[status]}</option>)}
          </select>
        )}
      </div>
    </article>
  );
}

// Same rules as the list view (TasksPanel): due dates are midnight UTC, Done tasks are never overdue.
function formatDue(value) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'Done') return false;
  const now = new Date();
  return new Date(task.dueDate).getTime() < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}
