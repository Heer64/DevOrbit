import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Keyboard, Search, X } from 'lucide-react';

/*
 * Solar Ember command palette (Ctrl K / Cmd K or "/") and keyboard shortcut sheet ("?").
 * Frontend only: every item just navigates or calls an action the app already has.
 * The last item always searches people and projects on Discover, so the old top-bar
 * search keeps working from here.
 */
export function CommandPalette({ open, onClose, items, onSearch }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { if (open) { setQuery(''); setSelected(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (item) => { const l = item.label.toLowerCase(); return l.startsWith(q) ? 0 : l.split(/[^a-z0-9]+/).some((w) => w.startsWith(q)) ? 1 : 2; };
    const found = q
      ? items.filter((item) => `${item.label} ${item.hint || ''} ${item.group}`.toLowerCase().includes(q)).map((item, i) => ({ item, i, r: rank(item) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.item)
      : items.filter((item) => !item.searchOnly);
    const list = found.slice(0, 12);
    if (q) list.push({ group: 'Search', label: `Search people and projects for "${query.trim()}"`, icon: Search, run: () => onSearch(query.trim()) });
    return list;
  }, [items, query, onSearch]);

  useEffect(() => { setSelected((s) => Math.min(s, Math.max(0, results.length - 1))); }, [results.length]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  if (!open) return null;
  const run = (item) => { onClose(); item?.run(); };
  const onKey = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((s) => (s + 1) % Math.max(results.length, 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((s) => (s - 1 + results.length) % Math.max(results.length, 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); run(results[selected]); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return (
    <div className="palette-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Search size={19} aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKey} placeholder="Type a command, project or person…" aria-label="Search commands" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={`palette-item-${selected}`} autoComplete="off" />
          <button type="button" className="palette-esc" onClick={onClose} aria-label="Close command palette">Esc</button>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((item, index) => {
            const head = item.group !== lastGroup ? <div className="palette-group" key={`g-${item.group}-${index}`}>{item.group}</div> : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return [head, (
              <button type="button" key={`${item.group}-${item.label}-${index}`} id={`palette-item-${index}`} role="option" aria-selected={index === selected} className={`palette-item ${index === selected ? 'sel' : ''}`} onMouseEnter={() => setSelected(index)} onClick={() => run(item)}>
                {item.dot ? <i className={`dot ${item.dot}`} aria-hidden="true" /> : Icon ? <Icon size={17} aria-hidden="true" /> : null}
                <span className="palette-label">{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
                {index === selected && <kbd aria-hidden="true"><CornerDownLeft size={12} /></kbd>}
              </button>
            )];
          })}
        </div>
        <div className="palette-foot"><span>↑ ↓ to move</span><span>Enter to open</span><span>Ctrl K to toggle</span><span>? for shortcuts</span></div>
      </div>
    </div>
  );
}

export const SHORTCUTS = [
  ['Ctrl K', 'Open the command palette'], ['/', 'Search (command palette)'], ['N', 'Create a project'],
  ['G then D', 'Go to Overview'], ['G then E', 'Go to Discover'], ['G then F', 'Go to Community feed'],
  ['G then M', 'Go to Messages'], ['G then P', 'Go to My profile'], ['T', 'Switch theme'], ['?', 'Show this list'], ['Esc', 'Close dialogs'],
];

export function ShortcutSheet({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="palette-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
        <div className="palette-input"><Keyboard size={19} aria-hidden="true" /><h2 id="shortcut-title">Keyboard shortcuts</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="Close shortcuts"><X size={16} /></button></div>
        <div className="shortcut-grid">{SHORTCUTS.map(([key, text]) => [<span key={`${key}-t`}>{text}</span>, <kbd key={`${key}-k`}>{key}</kbd>])}</div>
      </div>
    </div>
  );
}
