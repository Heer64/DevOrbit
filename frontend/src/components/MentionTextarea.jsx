import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { assetUrl } from '../api';
import { Avatar, initialsOf } from './ui';
import { activeMention, insertMention, suggestMembers } from './mentions';

/**
 * [Sprint 3 · US-20] A textarea that suggests project members while you type "@" (US-18 acceptance:
 * "suggestions limited to current project members"). Enter sends, Shift+Enter adds a new line;
 * while the suggestion list is open, Enter / Tab pick the highlighted member and Escape closes it.
 *
 * Props
 *   value, onChange(text)   controlled text
 *   onSubmit()              Enter without Shift (when no suggestion is open)
 *   members                 [{ userId, name, username, avatarUrl }]
 *   currentUserId           left out of the suggestions
 *   label, placeholder, maxLength, disabled, rows
 */
export default function MentionTextarea({ value, onChange, onSubmit, members = [], currentUserId = '', label = 'Message', placeholder = '', maxLength, disabled = false, rows = 2 }) {
  const boxRef = useRef(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(-1);
  // Caret to restore after a mention is inserted. Applied right after React updates the
  // textarea (layout effect), before any further typing, so fast typing cannot be reordered.
  const pendingCaret = useRef(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (pendingCaret.current === null || !box) return;
    const position = pendingCaret.current;
    pendingCaret.current = null;
    box.focus();
    box.setSelectionRange?.(position, position);
  }, [value]);

  const mention = activeMention(value, caret);
  const suggestions = useMemo(
    () => (mention ? suggestMembers(members, mention.query, { excludeId: currentUserId }) : []),
    [members, mention?.query, mention?.start, currentUserId] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const open = Boolean(mention) && suggestions.length > 0 && dismissedAt !== mention.start;
  // Typing "@" never fails silently: when nobody matches, say why.
  const mentionable = (members || []).some((member) => member.username && String(member.userId) !== String(currentUserId));
  const emptyNote = mention && !open && dismissedAt !== mention.start
    ? (mentionable ? `No project member matches "@${mention.query}".` : 'No teammates to mention yet. Add members to this project under Team & roles.')
    : '';
  const active = open ? Math.min(highlight, suggestions.length - 1) : 0;

  const syncCaret = (event) => setCaret(event.target.selectionStart ?? event.target.value.length);

  const pick = (member) => {
    const next = insertMention(value, mention, caret, member.username);
    pendingCaret.current = next.caret;
    onChange(next.text);
    setCaret(next.caret);
    setHighlight(0);
  };

  const onKeyDown = (event) => {
    if (open) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((active + 1) % suggestions.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((active - 1 + suggestions.length) % suggestions.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(suggestions[active]); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedAt(mention.start); return; }
    }
    if (emptyNote && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedAt(mention.start); return; }
    if (event.key === 'Enter' && !event.shiftKey) {
      // preventDefault also stops the surrounding task form from being submitted.
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="mention-box">
      <textarea
        ref={boxRef}
        value={value}
        onChange={(event) => { onChange(event.target.value); syncCaret(event); setHighlight(0); }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        placeholder={placeholder}
        aria-label={label}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
      />
      {emptyNote && <p className="mention-list mention-empty" role="status">{emptyNote}</p>}
      {open && (
        <ul className="mention-list" id={listId} role="listbox" aria-label="Mention a project member">
          {suggestions.map((member, index) => (
            <li
              key={member.userId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : ''}
              // mousedown, not click, so the textarea keeps focus.
              onMouseDown={(event) => { event.preventDefault(); pick(member); }}
              onMouseEnter={() => setHighlight(index)}
            >
              <Avatar initials={initialsOf(member.name)} src={assetUrl(member.avatarUrl)} small />
              <span>{member.name}</span>
              <small>@{member.username}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
