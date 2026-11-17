import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';

/*
 * Solar Ember motion layer, mounted once in main.jsx (not inside App, so component tests
 * never see it). It only adds data-* attributes and CSS custom properties, which React
 * leaves alone, so it never fights a component's className or state.
 *
 * - Scroll reveal, both ways: cards fade and rise in when they enter the screen and fade
 *   out (upward or downward) when they leave, then come back when you scroll back.
 * - Cursor spotlight: a soft orange glow follows the pointer across any card or panel.
 * - Scroll progress bar and a back-to-top button.
 * - Page fade: the main content eases in on every route change.
 * Without IntersectionObserver, or with "reduce motion", everything simply stays visible.
 */
const REVEAL = [
  '.content .panel', '.content .project-card', '.content .new-card', '.content .stat-card', '.content .person',
  '.content .welcome', '.content .discover-hero', '.content .profile-hero', '.content .pd-stat', '.content .post-card',
  '.content .heading', '.content .project-heading', '.content .placeholder', '[data-reveal]',
].join(',');
const SPOT = '.panel,.project-card,.new-card,.stat-card,.person,.auth-card,.modal,.welcome,.discover-hero,.post-card,.pd-stat,.intro-card,.glass';

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export default function MotionEffects() {
  const location = useLocation();
  const [showTop, setShowTop] = useState(false);

  // Scroll reveal (bidirectional) with a MutationObserver so cards that load later are included.
  useEffect(() => {
    if (typeof window.IntersectionObserver === 'undefined' || reducedMotion()) return undefined;
    document.documentElement.classList.add('sr-ready');
    const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
      const el = entry.target;
      if (entry.isIntersecting) el.setAttribute('data-sr', 'in');
      else el.setAttribute('data-sr', entry.boundingClientRect.top < 0 ? 'above' : 'below');
    }), { threshold: 0.06, rootMargin: '0px 0px -4% 0px' });
    // Each observer keeps its own list, so a second mount (React StrictMode in development) re-observes everything.
    const seen = new WeakSet();
    const tag = (root) => {
      const found = root.matches?.(REVEAL) ? [root] : [];
      root.querySelectorAll?.(REVEAL).forEach((el) => found.push(el));
      found.forEach((el) => {
        if (seen.has(el) || el.closest('.modal, .modal-back, .sidebar, .topbar')) return;
        if (el.parentElement?.closest('[data-sr]')) return; // nested cards move with their parent
        seen.add(el);
        const r = el.getBoundingClientRect();
        el.setAttribute('data-sr', r.top < window.innerHeight && r.bottom > 0 ? 'in' : r.bottom <= 0 ? 'above' : 'below');
        io.observe(el);
      });
    };
    tag(document.body);
    const mo = new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) tag(n); })));
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect(); mo.disconnect();
      document.documentElement.classList.remove('sr-ready');
      document.querySelectorAll('[data-sr]').forEach((el) => el.removeAttribute('data-sr'));
    };
  }, []);

  // Cursor spotlight on cards.
  useEffect(() => {
    let raf = 0; let ev = null;
    const onMove = (e) => {
      ev = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!ev || ev.pointerType === 'touch' || !(ev.target instanceof Element)) return;
        const card = ev.target.closest(SPOT);
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${ev.clientX - r.left}px`);
        card.style.setProperty('--my', `${ev.clientY - r.top}px`);
      });
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => { document.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);

  // Scroll progress + back to top.
  useEffect(() => {
    const bar = document.getElementById('scroll-progress');
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
        setShowTop(window.scrollY > 700);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  // Page fade on route change: restart a short CSS animation on the main content.
  useEffect(() => {
    if (reducedMotion()) return;
    const content = document.querySelector('.content');
    if (!content) return;
    content.removeAttribute('data-route-in');
    void content.offsetWidth; // restart the animation
    content.setAttribute('data-route-in', '');
  }, [location.pathname]);

  return (
    <>
      <div className="ambient" aria-hidden="true"><i className="o1" /><i className="o2" /><i className="o3" /></div>
      <div className="grain" aria-hidden="true" />
      <div id="scroll-progress" className="scroll-progress" aria-hidden="true" />
      <button type="button" className={`to-top ${showTop ? 'show' : ''}`} aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })}><ArrowUp size={18} /></button>
    </>
  );
}
