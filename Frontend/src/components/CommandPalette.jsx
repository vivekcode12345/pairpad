import { useEffect, useRef, useState } from 'react';
import { CodeIcon, GithubIcon, ReplayIcon, SearchIcon } from './Icons';

const ACTIONS = [
  { id: 'join', title: 'Join or create a room', hint: 'Open the shared room form', icon: CodeIcon },
  { id: 'interview', title: 'Start an interview', hint: 'Set up a structured interview', icon: CodeIcon },
  { id: 'replay', title: 'Watch a replay', hint: 'Review a completed session', icon: ReplayIcon },
  { id: 'generate', title: 'Generate a room ID', hint: 'Create a new room identifier', icon: SearchIcon },
  { id: 'github', title: 'Open GitHub repository', hint: 'Open the project repository', icon: GithubIcon },
];

export default function CommandPalette({ onClose, triggerRef, actions }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const filteredRef = useRef([]);
  const activeRef = useRef(0);
  const actionsRef = useRef(actions);
  const filtered = ACTIONS.filter((action) => `${action.title} ${action.hint} ${action.id}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    filteredRef.current = filtered;
    activeRef.current = active;
    actionsRef.current = actions;
  }, [active, actions, filtered]);

  useEffect(() => {
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => filteredRef.current.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + filteredRef.current.length) % filteredRef.current.length : 0);
      }
      if (event.key === 'Enter' && filteredRef.current[activeRef.current]) { event.preventDefault(); actionsRef.current[filteredRef.current[activeRef.current].id](); onClose(); }
      if (event.key === 'Tab') {
        const focusable = [...(listRef.current?.querySelectorAll('input,button') || [])];
        if (!focusable.length) return;
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
        else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(focusTimer); document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); trigger?.focus(); };
  }, [onClose, triggerRef]);

  return <div className="cc-command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="cc-command-palette" role="dialog" aria-modal="true" aria-label="Quick actions" ref={listRef}>
      <div className="cc-command-search"><SearchIcon /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder="Search actions..." aria-label="Search actions" /></div>
      <div className="cc-command-list" role="listbox" aria-activedescendant={filtered[active] ? `command-${filtered[active].id}` : undefined}>
        {filtered.length ? filtered.map((action, index) => {
          const Icon = action.icon;
          return <button type="button" role="option" aria-selected={index === active} id={`command-${action.id}`} className={`cc-command-row ${index === active ? 'active' : ''}`} key={action.id} onMouseEnter={() => setActive(index)} onClick={() => { actions[action.id](); onClose(); }}><Icon /><span><strong>{action.title}</strong><small>{action.hint}</small></span></button>;
        }) : <p className="cc-command-empty">No matching actions</p>}
      </div>
      <footer className="cc-command-footer">↑↓ navigate&nbsp;&nbsp; ↵ select&nbsp;&nbsp; esc close</footer>
    </section>
  </div>;
}
