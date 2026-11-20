/*
 * [Sprint 7 · M7] D7: words for the weekly goal card.
 * weekGoal = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', total, done, percent } -> { percent, headline, detail } | null
 */
export function weekGoalView(weekGoal) {
  if (!weekGoal || !Number.isFinite(weekGoal.total) || !Number.isFinite(weekGoal.done)) return null;
  const total = Math.max(0, weekGoal.total);
  const done = Math.min(total, Math.max(0, weekGoal.done));
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const range = weekRange(weekGoal.from, weekGoal.to);
  if (total === 0) {
    return {
      percent,
      headline: 'No tasks due this week',
      detail: `Nothing assigned to you is due ${range || 'this week'}. Give your tasks due dates to track a weekly goal.`,
    };
  }
  const left = total - done;
  return {
    percent,
    headline: `${done} of ${total} done`,
    detail:
      left === 0
        ? `Every task assigned to you that is due ${range || 'this week'} is done.`
        : `${left} still to finish${range ? ` (${range})` : ' this week'}. Counts tasks assigned to you.`,
  };
}

function weekRange(from, to) {
  const fmt = (value) => {
    const date = value ? new Date(`${value}T00:00:00.000Z`) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      : '';
  };
  const a = fmt(from);
  const b = fmt(to);
  return a && b ? `${a} – ${b}` : '';
}
