import { useEffect, useRef } from 'react';
import { Button } from './ui';
import { scrollToSection } from '../scrollTo';

export default function CtaBand({ sectionRefs, focusName }) {
  const bandRef = useRef(null);
  useEffect(() => {
    const root = bandRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && root.classList.add('is-visible'), { threshold: .2 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const go = (id, focusId) => {
    scrollToSection(sectionRefs[id]?.current, id);
    focusName(focusId);
  };
  return <section className="cc-cta-band cc-reveal" ref={bandRef} aria-labelledby="cta-heading">
    <div><span className="cc-eyebrow">PAIRPAD</span><h2 id="cta-heading">Ready to code together?</h2></div>
    <div className="cc-cta-actions"><Button variant="primary" onClick={() => go('start', 'join')}>Join a room</Button><Button variant="primary" onClick={() => go('interview', 'interview')}>Start an interview</Button></div>
  </section>;
}
