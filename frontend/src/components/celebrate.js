// [Solar Ember] A small confetti burst, like the demo's Kanban "Done" moment. Frontend only.
// Does nothing without the Web Animations API (tests, old browsers) or when the user prefers less motion.
const COLORS = ['#ff8a3d', '#ffa552', '#ffe8cc', '#ff5d73', '#ffd166', '#5ee8a8'];

export function confettiAt(target) {
  if (typeof window === 'undefined' || !target || typeof document.body.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const box = target.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  for (let i = 0; i < 26; i += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.background = COLORS[i % COLORS.length];
    document.body.appendChild(piece);
    const angle = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 150;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed - 120;
    piece.animate([
      { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 220}px)) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = () => piece.remove();
  }
}

export function celebrateTask(taskId) {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame?.(() => {
    const card = document.querySelector(`[data-task-id="${String(taskId).replace(/["\\]/g, '')}"]`);
    confettiAt(card);
  });
}
