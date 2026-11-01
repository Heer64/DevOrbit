import {
  CheckCircle2, CircleDot, Flag, FolderPlus, Gavel, GitCommitHorizontal, GitPullRequest, ListTodo, Mail,
  MessageCircle, MessageSquare, Pencil, ShieldCheck, Trash2, UserMinus, UserPlus, UserRoundCheck,
} from 'lucide-react';

// Icon and colour for each activity type sent by the API (backend/src/models/Activity.js).
const LOOK = {
  'project.created': { icon: FolderPlus, tone: 'purple', title: 'Project created' },
  'project.updated': { icon: Pencil, tone: 'blue', title: 'Project updated' },
  // [Sprint 4 · M8] US-15
  'project.completed': { icon: CheckCircle2, tone: 'green', title: 'Project completed' },
  'project.reopened': { icon: FolderPlus, tone: 'blue', title: 'Project reopened' },
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
  // [US-29]
  'message.posted': { icon: MessageSquare, tone: 'blue', title: 'New message' },
  'invite.sent': { icon: Mail, tone: 'purple', title: 'Invite sent' },
  'invite.accepted': { icon: UserRoundCheck, tone: 'green', title: 'Invite accepted' },
  'invite.declined': { icon: Mail, tone: 'orange', title: 'Invite declined' },
  'join_request.created': { icon: UserPlus, tone: 'blue', title: 'Join request submitted' },
  'join_request.approved': { icon: UserRoundCheck, tone: 'green', title: 'Join request approved' },
  'join_request.rejected': { icon: UserMinus, tone: 'orange', title: 'Join request rejected' },
  'comment.created': { icon: MessageCircle, tone: 'blue', title: 'Comment added' },
  'decision.created': { icon: Gavel, tone: 'purple', title: 'Decision recorded' },
  'decision.updated': { icon: Gavel, tone: 'blue', title: 'Decision updated' },
  'github.commit': { icon: GitCommitHorizontal, tone: 'green', title: 'Commit pushed' },
  'github.issue': { icon: CircleDot, tone: 'blue', title: 'GitHub issue updated' },
  'github.pull_request': { icon: GitPullRequest, tone: 'purple', title: 'Pull request updated' },
};

// [US-29] Every type the feed knows, in display order. Used by the Activity tab's type filter.
export const ACTIVITY_TYPE_KEYS = Object.keys(LOOK);

export function activityLook(event) {
  const look = LOOK[event?.type] || { icon: Pencil, tone: 'blue', title: 'Update' };
  // A task that reached Done gets its own title, like the old sample feed.
  if (event?.type === 'task.status_changed' && event.meta?.to === 'Done') return { ...look, title: 'Task completed' };
  return look;
}

// "Riya Kapoor created task "Login page"".
export function activitySentence(event) {
  // [US-29] GitHub events may have no FORGE user, so fall back to the GitHub username.
  const who = event?.actor?.name || event?.meta?.author || 'Someone';
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
