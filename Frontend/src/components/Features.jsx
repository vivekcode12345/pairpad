import { useEffect } from 'react';
import { CodeIcon, CursorIcon, ReplayIcon, ShieldIcon, TerminalIcon, TimerIcon } from './Icons';

const FEATURES = [
  ['Conflict-free live sync', 'Built on Yjs CRDTs. Two people typing on the same line never overwrite each other, and edits made while offline merge back automatically.', CodeIcon, 'merge'],
  ['Live cursors & presence', "See every collaborator's cursor, selection and name in their own color, and who is in the room.", CursorIcon, 'presence'],
  ['Sandboxed execution', 'Run JavaScript, Python, C++ and Java on the server with stdin support. Nothing runs on your machine or the host.', TerminalIcon, 'terminal'],
  ['Session replay', 'Every session is recorded as timestamped events. Replay it like a video: scrub, change speed, skip idle gaps, export JSON.', ReplayIcon, 'timeline'],
  ['Interview mode', 'Pick a problem, set a timer, and the server judges submissions against hidden test cases. Candidates only see pass/fail verdicts.', TimerIcon, 'verdict'],
  ['Safe by design', 'Hidden tests never leave the server, payloads are size-limited, and the run and replay endpoints are rate-limited.', ShieldIcon, 'shield'],
];

function Visual({ type }) {
  if (type === 'merge') return <span className="cc-feature-visual cc-visual-merge"><i>const</i> <b>sync</b><em>+</em><b>merge</b></span>;
  if (type === 'presence') return <span className="cc-feature-visual cc-visual-presence"><i /><i /><b>Ada</b><b>Linus</b></span>;
  if (type === 'terminal') return <span className="cc-feature-visual cc-visual-terminal"><code>&gt; run</code><strong>✓ 42</strong></span>;
  if (type === 'timeline') return <span className="cc-feature-visual cc-visual-timeline"><i /><b /><i /><i /></span>;
  if (type === 'verdict') return <span className="cc-feature-visual cc-visual-verdict"><b>AC</b><b>WA</b><small>00:42</small></span>;
  return <span className="cc-feature-visual cc-visual-shield"><ShieldIcon /></span>;
}

export default function Features({ sectionRef }) {
  useEffect(() => {
    const root = sectionRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')), { threshold: .12 });
    root.querySelectorAll('.cc-reveal').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sectionRef]);
  return <section className="cc-section cc-features-section" id="features" ref={sectionRef} tabIndex="-1">
    <div className="cc-section-heading cc-reveal"><span className="cc-eyebrow">THE WORKSPACE</span><h2>Everything you need to code together</h2><p>From live pairing to hidden-test judging, in one workspace.</p></div>
    <div className="cc-features-grid">{FEATURES.map(([title, description, Icon, type], index) => <article className="cc-feature-card cc-reveal" style={{ '--reveal-delay': `${index * 60}ms` }} key={title}><div className="cc-feature-top"><div className="cc-feature-icon"><Icon /></div><span className="cc-feature-index">0{index + 1}</span></div><h3>{title}</h3><p>{description}</p><Visual type={type} /></article>)}</div>
  </section>;
}
