import { CheckCircle2, Flag, FolderPlus, ListTodo, Pencil, ShieldCheck, Trash2, UserMinus, UserPlus, UserRoundCheck } from 'lucide-react';

// Icon and colour for each activity type sent by the API (backend/src/models/Activity.js).
const LOOK = {
  'project.created': { icon: FolderPlus, tone: 'purple', title: 'Project created' },
  'project.updated': { icon: Pencil, tone: 'blue', title: 'Project updated' },
  'member.added': { icon: UserPlus, tone: 'blue', title: 'New collaborator' },
  'member.role_changed': { icon: ShieldCheck, tone: 'purple', title: 'Role changed' },
  'member.removed': { icon: UserMinus, tone: 'orange', title: 'Member removed' },
  'member.left': { icon: UserMinus, tone: 'orange', title: 'Member left' },
  'task.created': { icon: ListTodo, tone: 'purple', title: 'Task created' },
  'task.updated': { icon: Pencil, tone: 'blue', title: 'Task updated' },
  'task.status_changed': { icon: CheckCircle2, tone: 'green', title: 'Task moved' },
  'task.assigned': { icon: UserRoundCheck, tone: 'blue', title: 'Task assigned' },
  'task.deleted': { icon: Trash2, tone: 'orange', title: 'Task deleted' },
  'milestone.created': { icon: Flag, tone: 'purple', title: 'Milestone created' },
  'milestone.updated': { icon: Flag, tone: 'blue', title: 'Milestone updated' },
  'milestone.deleted': { icon: Trash2, tone: 'orange', title: 'Milestone deleted' },
};

export function activityLook(event) {
  const look = LOOK[event?.type] || { icon: Pencil, tone: 'blue', title: 'Update' };
  // A task that reached Done gets its own title, like the old sample feed.
  if (event?.type === 'task.status_changed' && event.meta?.to === 'Done') return { ...look, title: 'Task completed' };
  return look;
}

// "Riya Kapoor created task "Login page"".
export function activitySentence(event) {
  const who = event?.actor?.name || 'Someone';
  return `${who} ${event?.summary || ''}`.trim();
}

// "just now", "12 min ago", "3 hours ago", "Yesterday", "Oct 14".
export function timeAgo(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
