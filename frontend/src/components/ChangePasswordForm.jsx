import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound } from 'lucide-react';
import { settingsApi } from '../api';
import { PASSWORD_FORM_MESSAGES, changePasswordFormProblem, passwordStrength } from '../settings';
import { Btn } from './ui';

/*
 * [Sprint 7 · M5] Settings → Security: change my password.
 *   - The current (old) password is required; the new one is typed twice.
 *   - POST /api/settings/password (backend/src/routes/settings.js). On success every OTHER session is signed out
 *     and this browser stays signed in; the server's message says how many were signed out.
 *   - A wrong current password comes back as 400 code 'current_password_wrong' (never 401, so a typo does not
 *     sign you out). The new passwords stay filled in so only the old one has to be typed again.
 *   - Demo accounts have no password, so the form is disabled for them.
 */
export default function ChangePasswordForm({ user, api = settingsApi }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const currentRef = useRef(null);
  // Focus the current-password box after a wrong guess. Done in an effect, because the box is disabled while
  // the request runs and a disabled input cannot take focus.
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => { if (focusTick) currentRef.current?.focus(); }, [focusTick]);
  const demo = Boolean(user?.isDemo);
  const strength = passwordStrength(next);

  const edit = (setter) => (event) => { setter(event.target.value); setError(''); setNotice(''); };

  const submit = async (event) => {
    event.preventDefault();
    if (saving || demo) return;
    setNotice('');
    const problem = changePasswordFormProblem({ current, next, confirm });
    if (problem) { setError(problem); return; }
    setError('');
    setSaving(true);
    try {
      const result = await api.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm(''); setShow(false);
      setNotice(result?.message || 'Your password has been changed.');
    } catch (e) {
      const code = e?.response?.data?.code || e?.code;
      setError(e?.message || PASSWORD_FORM_MESSAGES.failed);
      if (code === 'current_password_wrong') {
        setCurrent('');
        setFocusTick((tick) => tick + 1);
      }
    } finally {
      setSaving(false);
    }
  };

  const type = show ? 'text' : 'password';

  return (
    <section className="panel settings-card" aria-label="Change password">
      <div className="panel-head">
        <div>
          <div className="eyebrow"><KeyRound size={12} /> SECURITY</div>
          <h2 style={{ marginTop: 6 }}>Change password</h2>
          <p>You need your current password. Every other device signed in to this account will be signed out; this one stays signed in.</p>
        </div>
      </div>

      {demo ? (
        <p className="tiny-note settings-demo-note">{PASSWORD_FORM_MESSAGES.demo}</p>
      ) : (
        <form className="settings-form" onSubmit={submit} noValidate>
          {/* Helps password managers save the new password against the right account. */}
          <input type="email" name="username" autoComplete="username" value={user?.email || ''} readOnly hidden aria-hidden="true" />
          <label>Current password
            <input ref={currentRef} className="field-input" type={type} name="current-password" autoComplete="current-password" value={current} onChange={edit(setCurrent)} disabled={saving} maxLength={256} />
          </label>
          <div className="settings-form-pair">
            <label>New password
              <input className="field-input" type={type} name="new-password" autoComplete="new-password" value={next} onChange={edit(setNext)} disabled={saving} maxLength={128} aria-describedby="new-password-hint" />
            </label>
            <label>Confirm new password
              <input className="field-input" type={type} name="confirm-password" autoComplete="new-password" value={confirm} onChange={edit(setConfirm)} disabled={saving} maxLength={128} />
            </label>
          </div>
          <div className="settings-form-meta">
            <span id="new-password-hint" className={`pw-strength level-${strength.level}`}>
              <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
              <small>{strength.label ? `Strength: ${strength.label}` : '8 to 128 characters.'}</small>
            </span>
            <button type="button" className="link" onClick={() => setShow((value) => !value)} aria-pressed={show}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}{show ? 'Hide passwords' : 'Show passwords'}
            </button>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          {notice && <p className="success-inline" role="status">{notice}</p>}
          <div className="settings-footer">
            <Btn type="submit" icon={Check} disabled={saving || !current || !next || !confirm}>{saving ? 'Changing…' : 'Change password'}</Btn>
          </div>
        </form>
      )}
    </section>
  );
}
