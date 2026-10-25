import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Logo } from './ui';
import { GithubIcon, MenuIcon, SearchIcon } from './Icons';
import CommandPalette from './CommandPalette';
import { scrollToSection } from '../scrollTo';

const GITHUB_URL = import.meta.env.VITE_GITHUB_URL?.trim() || 'https://github.com/vivekcode12345';
const LINKS = [
  ['Demo', 'demo'],
  ['Get started', 'start'],
  ['Features', 'features'],
  ['How it works', 'how'],
];

export default function Navbar({ onGenerate, focusName, sectionRefs }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [active, setActive] = useState('demo');
  const [hovered, setHovered] = useState(null);
  const navRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const triggerRef = useRef(null);
  const highlightRef = useRef(null);
  const linksRef = useRef({});
  const [shortcut] = useState(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K');

  const scrollTo = useCallback((id) => {
    const target = sectionRefs[id]?.current;
    if (!target) return;
    scrollToSection(target, id);
    setMobileOpen(false);
  }, [sectionRefs]);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const actions = {
    join: () => { scrollTo('join'); focusName('join'); },
    interview: () => { scrollTo('interview'); focusName('interview'); },
    replay: () => { scrollTo('replay'); focusName('replay'); },
    generate: () => { scrollTo('join'); onGenerate(); focusName('join'); },
    github: () => window.open(GITHUB_URL, '_blank', 'noopener,noreferrer'),
  };

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); };
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setMobileOpen(false); };
    const onPointerDown = (event) => {
      if (!mobileMenuRef.current?.contains(event.target) && !event.target.closest('.cc-navbar')) setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown); };
  }, [mobileOpen]);
  useEffect(() => {
    const observers = LINKS.map(([, id]) => {
      const element = sectionRefs[id]?.current;
      if (!element) return null;
      const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setActive(id); }, { rootMargin: '-40% 0px -55% 0px' });
      observer.observe(element);
      return observer;
    });
    return () => observers.forEach((observer) => observer?.disconnect());
  }, [sectionRefs]);
  useEffect(() => {
    const update = () => {
      const link = linksRef.current[hovered || active];
      const container = navRef.current;
      if (!link || !container || !highlightRef.current) return;
      const parent = container.getBoundingClientRect();
      const rect = link.getBoundingClientRect();
      highlightRef.current.style.transform = `translateX(${rect.left - parent.left}px)`;
      highlightRef.current.style.width = `${rect.width}px`;
    };
    update();
    window.addEventListener('resize', update);
    document.fonts?.addEventListener('loadingdone', update);
    return () => { window.removeEventListener('resize', update); document.fonts?.removeEventListener('loadingdone', update); };
  }, [active, hovered]);

  return createPortal(<>
    <a className="cc-skip-link" href="#main-content">Skip to content</a>
    <div className={`cc-navbar-wrap ${scrolled ? 'scrolled' : ''}`}>
      <header className="cc-navbar">
        <Logo />
        <nav className="cc-navbar-links" aria-label="Primary" ref={navRef} onMouseLeave={() => setHovered(null)}>
          <span className="cc-nav-highlight" ref={highlightRef} />
          {LINKS.map(([label, id]) => <a href={`#${id}`} key={id} ref={(element) => { linksRef.current[id] = element; }} aria-current={active === id ? 'true' : undefined} onMouseEnter={() => setHovered(id)} onClick={(event) => { event.preventDefault(); scrollTo(id); }}>{label}</a>)}
        </nav>
        <div className="cc-navbar-actions">
          <button className="cc-search-pill" type="button" ref={triggerRef} onClick={openPalette}><SearchIcon /><span>Quick actions</span><kbd>{shortcut}</kbd></button>
          <a className="cc-navbar-github" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub repository"><GithubIcon /></a>
          <IconButton label="Open navigation menu" aria-expanded={mobileOpen} aria-controls="cc-mobile-menu" onClick={() => setMobileOpen((value) => !value)}><MenuIcon /></IconButton>
        </div>
      </header>
      {mobileOpen && <div className="cc-mobile-menu" id="cc-mobile-menu" ref={mobileMenuRef}><nav aria-label="Mobile primary">{LINKS.map(([label, id]) => <a href={`#${id}`} key={id} onClick={(event) => { event.preventDefault(); scrollTo(id); }}>{label}</a>)}</nav><button type="button" onClick={() => { setMobileOpen(false); openPalette(); }}><SearchIcon />Quick actions</button><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer"><GithubIcon />GitHub repository</a></div>}
    </div>
    {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} triggerRef={triggerRef} actions={actions} />}
  </>, document.body);
}
