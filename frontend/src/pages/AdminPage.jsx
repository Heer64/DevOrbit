import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, RotateCcw, Search, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import { adminApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { Avatar, EmptyPanel, Heading, initialsOf } from '../components/ui';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  ADMIN_ONLY_MESSAGE,
  ADMIN_ROLE_OPTIONS,
  ADMIN_SEARCH_MAX,
  ADMIN_STATUS_OPTIONS,
  adminDate,
  adminErrorMessage,
  adminListParams,
  isPlatformAdmin,
} from '../platformRoles';

/*
 * [Sprint 6 · M8] Admin panel at /admin (US-57 assign/revoke moderators, US-58 suspend/reactivate accounts).
 *
 * Only for Platform Admins: the sidebar link is shown to them only, and everyone else who opens /admin sees
 * "Only a Platform Admin can open the Admin panel." The real check is on the server (403 for anyone else).
 *
 *   - Search accounts by name, @username or e-mail; filter by status and role; 20 per page.
 *   - "Content Moderator" switch on each row: grants or revokes the role. It applies on that user's next request.
 *   - Suspend (asks first): the user is logged out everywhere at once and cannot log in. Reactivate: they can again.
 *   - Platform Admin rows have no switches: admins come from the seed script or the server settings (FR-27).
 *
 * Props: api (adminApi, swapped in tests).
 */
export default function AdminPage({ api = adminApi }) {
  const { user } = useAuth();
  if (!isPlatformAdmin(user)) return <AdminOnly />;
  return <AdminPanel api={api} />;
}

function AdminOnly() {
  return (
    <div className="admin-page">
      <Heading eyebrow="PLATFORM" title="Admin panel" />
      <EmptyPanel icon={ShieldAlert} title="Admins only" text={ADMIN_ONLY_MESSAGE} />
    </div>
  );
}

const EMPTY_FILTERS = { q: '', status: 'all', role: 'all' };

function AdminPanel({ api }) {
  const [draft, setDraft] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState({}); // { [userId]: true } while a change for that account is on its way
  const [notice, setNotice] = useState(null); // { kind: 'success' | 'error', text }
  const [confirming, setConfirming] = useState(null); // the account waiting for "Suspend account"
  const [confirmError, setConfirmError] = useState('');
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    setLoadError('');
    try {
      const result = await api.users(adminListParams({ ...filters, page }));
      if (latest.current !== ticket) return; // an older search answered after a newer one
      setData({
        users: result.users || [],
        total: Number(result.total || 0),
        pageSize: Number(result.pageSize || 20),
        summary: result.summary || { moderators: 0, admins: 0, suspended: 0 },
      });
    } catch (error) {
      if (latest.current !== ticket) return;
      if ((error?.status ?? error?.response?.status) === 403) setForbidden(true);
      setData((current) => current || { users: [], total: 0, pageSize: 20, summary: { moderators: 0, admins: 0, suspended: 0 } });
      setLoadError(adminErrorMessage(error, 'Could not load the accounts. Please try again.'));
    }
  }, [api, filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const applyFilters = (next) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  };
  const submitSearch = (event) => {
    event.preventDefault();
    applyFilters({ q: draft.trim() });
  };
  const resetFilters = () => {
    setDraft('');
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  // Puts the account the server sent back into the list and keeps the summary numbers right.
  const replaceUser = (updated) => {
    setData((current) => {
      if (!current) return current;
      const before = current.users.find((row) => row.id === updated.id);
      const summary = { ...current.summary };
      if (before) {
        if (before.platformRole !== 'moderator' && updated.platformRole === 'moderator') summary.moderators += 1;
        if (before.platformRole === 'moderator' && updated.platformRole !== 'moderator') summary.moderators -= 1;
        if (!before.suspended && updated.suspended) summary.suspended += 1;
        if (before.suspended && !updated.suspended) summary.suspended -= 1;
      }
      return { ...current, summary, users: current.users.map((row) => (row.id === updated.id ? updated : row)) };
    });
  };

  const run = async (account, action) => {
    setBusy((current) => ({ ...current, [account.id]: true }));
    setNotice(null);
    try {
      const result = await action();
      if (result?.user) replaceUser(result.user);
      setNotice({ kind: 'success', text: result?.message || 'Saved.' });
      return true;
    } catch (error) {
      const text = adminErrorMessage(error);
      setNotice({ kind: 'error', text });
      return text;
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
    }
  };

  const toggleModerator = (account) =>
    run(account, () => api.setRole(account.id, account.platformRole === 'moderator' ? 'user' : 'moderator'));
  const reactivate = (account) => run(account, () => api.reactivate(account.id));
  const askSuspend = (account) => {
    setConfirmError('');
    setConfirming(account);
  };
  const confirmSuspend = async () => {
    const account = confirming;
    if (!account) return;
    const outcome = await run(account, () => api.suspend(account.id));
    if (outcome === true) setConfirming(null);
    else setConfirmError(outcome);
  };

  if (forbidden) return <AdminOnly />;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const first = data && data.total ? (page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.total, (page - 1) * data.pageSize + data.users.length) : 0;
  const filtered = filters.q || filters.status !== 'all' || filters.role !== 'all';

  return (
    <div className="admin-page">
      <Heading
        eyebrow="PLATFORM"
        title="Admin panel"
        subtitle="Give or take away the Content Moderator role, and suspend or reactivate accounts. Changes apply on the person's next request."
      />

      {data && (
        <div className="admin-summary" aria-label="Platform summary">
          <span>
            <ShieldCheck size={14} /> <b>{data.summary.moderators}</b> Content Moderators
          </span>
          <span>
            <Users size={14} /> <b>{data.summary.admins}</b> Platform Admins
          </span>
          <span className={data.summary.suspended ? 'warn' : ''}>
            <Ban size={14} /> <b>{data.summary.suspended}</b> suspended
          </span>
        </div>
      )}

      <section className="panel admin-panel" aria-labelledby="admin-accounts-title">
        <div className="panel-head">
          <div>
            <h2 id="admin-accounts-title">Accounts</h2>
            <p>{data ? (data.total ? `Showing ${first}–${last} of ${data.total}` : 'No accounts to show') : 'Loading accounts…'}</p>
          </div>
        </div>

        <form className="admin-filters" role="search" onSubmit={submitSearch}>
          <label className="admin-search">
            <Search size={14} />
            <input
              type="search"
              aria-label="Search accounts"
              placeholder="Name, @username or e-mail"
              value={draft}
              maxLength={ADMIN_SEARCH_MAX}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" className="btn secondary small">
            Search
          </button>
          <select
            className="field-input"
            aria-label="Status"
            value={filters.status}
            onChange={(event) => applyFilters({ status: event.target.value })}
          >
            {ADMIN_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="field-input"
            aria-label="Role"
            value={filters.role}
            onChange={(event) => applyFilters({ role: event.target.value })}
          >
            {ADMIN_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </form>

        {notice?.kind === 'success' && (
          <p className="success-inline admin-notice" role="status">
            {notice.text}
          </p>
        )}
        {notice?.kind === 'error' && !confirming && (
          <div className="form-error admin-notice" role="alert">
            {notice.text}
          </div>
        )}
        {loadError && (
          <div className="form-error admin-notice" role="alert">
            {loadError}{' '}
            <button type="button" className="link" onClick={load}>
              Try again
            </button>
          </div>
        )}

        {data && data.users.length === 0 && !loadError && (
          <EmptyPanel
            icon={Users}
            title={filtered ? 'No accounts match' : 'No accounts yet'}
            text={filtered ? 'Try another name, e-mail or filter.' : 'Accounts appear here as people sign up.'}
            onReset={filtered ? resetFilters : undefined}
          />
        )}

        {data && data.users.length > 0 && (
          <ul className="admin-users" aria-label="Accounts">
            {data.users.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={Boolean(busy[account.id])}
                onToggleModerator={() => toggleModerator(account)}
                onSuspend={() => askSuspend(account)}
                onReactivate={() => reactivate(account)}
              />
            ))}
          </ul>
        )}

        {data && totalPages > 1 && (
          <nav className="admin-pages" aria-label="Pages">
            <button type="button" className="btn secondary small" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={14} /> Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button type="button" className="btn secondary small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight size={14} />
            </button>
          </nav>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirming ? `Suspend ${confirming.name}?` : ''}
        confirmLabel="Suspend account"
        danger
        busy={confirming ? Boolean(busy[confirming.id]) : false}
        error={confirmError}
        onConfirm={confirmSuspend}
        onCancel={() => setConfirming(null)}
      >
        <p>They are logged out on every device right away and can't log in until you reactivate the account.</p>
        <p>Their posts, projects and messages stay as they are.</p>
      </ConfirmDialog>
    </div>
  );
}

function AccountRow({ account, busy, onToggleModerator, onSuspend, onReactivate }) {
  const isAdmin = account.platformRole === 'admin';
  const isModerator = account.platformRole === 'moderator';
  return (
    <li className={`admin-user ${account.suspended ? 'is-suspended' : ''}`} aria-label={account.name}>
      <div className="admin-user-who">
        <Avatar initials={initialsOf(account.name)} />
        <div>
          <b>{account.name}</b> {account.isMe && <span className="admin-badge me">You</span>}
          <small>
            @{account.username} · {account.email}
          </small>
        </div>
      </div>

      <div className="admin-user-state">
        <span className={`admin-badge role-${account.platformRole}`}>{account.roleLabel}</span>
        {account.suspended ? (
          <span className="admin-badge suspended">Suspended{account.suspendedAt ? ` since ${adminDate(account.suspendedAt)}` : ''}</span>
        ) : (
          <span className="admin-badge active">Active</span>
        )}
      </div>

      <div className="admin-user-actions">
        {isAdmin ? (
          <span className="muted-note">Platform Admins can't be changed here.</span>
        ) : (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={isModerator}
              aria-label={`Content Moderator: ${account.name}`}
              className={`admin-switch ${isModerator ? 'on' : ''}`}
              disabled={busy}
              onClick={onToggleModerator}
            >
              <i aria-hidden="true" /> Moderator
            </button>
            {account.suspended ? (
              <button
                type="button"
                className="btn secondary small"
                aria-label={`Reactivate ${account.name}`}
                disabled={busy}
                onClick={onReactivate}
              >
                <RotateCcw size={13} /> Reactivate
              </button>
            ) : (
              <button
                type="button"
                className="btn secondary small admin-danger"
                aria-label={`Suspend ${account.name}`}
                disabled={busy}
                onClick={onSuspend}
              >
                <Ban size={13} /> Suspend
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
