import { useEffect, useRef, useState } from 'react';
import { OrbitGlass } from './Logo';

/*
 * The DevOrbit logo in live 3D: a transparent orange glass D with a faint edge outline,
 * a glowing core, a chrome orbit ring with a moving moon and a fainter outer ring with a
 * coral satellite. It floats, sways, tilts toward the pointer and turns a little on scroll.
 *
 * - three.js (r128) is loaded from cdnjs only when this component is on screen, so it is
 *   not an npm dependency and other pages never download it.
 * - Until it loads, or when WebGL / the network is unavailable (tests in jsdom, old
 *   browsers, offline), the animated SVG logo (OrbitGlass) is shown instead.
 * - "Reduce motion": one still frame. Everything is disposed when the component unmounts.
 */
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
let threePromise = null;

function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threePromise) {
    threePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = THREE_URL;
      script.async = true;
      script.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error('three.js missing')));
      script.onerror = () => { threePromise = null; reject(new Error('three.js could not load')); };
      document.head.appendChild(script);
    });
  }
  return threePromise;
}

function canUseWebGL() {
  if (typeof window === 'undefined' || typeof window.WebGLRenderingContext === 'undefined') return false;
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch { return false; }
}

function buildScene(T, canvas) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0, 6.6);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // Warm studio environment for reflections.
  const env = new T.Scene();
  env.add(new T.Mesh(keep(new T.BoxGeometry(20, 20, 20)), keep(new T.MeshBasicMaterial({ color: 0x140b08, side: T.BackSide }))));
  const panel = (color, k, w, h, pos) => {
    const m = new T.Mesh(keep(new T.PlaneGeometry(w, h)), keep(new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), side: T.DoubleSide })));
    m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(0xffffff, 3.0, 6, 2, [0, 6, 4]); panel(0xff8a3d, 2.5, 4, 8, [-7, 0, 2]); panel(0xffe8cc, 2.0, 3, 6, [7, -1, 1]); panel(0xffc98f, 1.6, 8, 2, [0, -6, -3]);
  const pmrem = new T.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(env, 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();
  scene.add(new T.AmbientLight(0xd08a5a, 0.4));
  const key = new T.DirectionalLight(0xffffff, 1.4); key.position.set(3, 4, 5); scene.add(key);
  const rim = new T.PointLight(0xffe8cc, 2.2, 20); rim.position.set(-4, -2, 3); scene.add(rim);
  scene.add(new T.PointLight(0xff8a3d, 3, 12));

  // Monogram D, transparent glass with a faint outline.
  const shape = new T.Shape();
  shape.moveTo(-0.85, -1); shape.lineTo(0, -1); shape.absarc(0, 0, 1, -Math.PI / 2, Math.PI / 2, false); shape.lineTo(-0.85, 1); shape.lineTo(-0.85, -1);
  const hole = new T.Path();
  hole.moveTo(-0.42, 0.52); hole.lineTo(0, 0.52); hole.absarc(0, 0, 0.52, Math.PI / 2, -Math.PI / 2, true); hole.lineTo(-0.42, -0.52); hole.lineTo(-0.42, 0.52);
  shape.holes.push(hole);
  const geo = keep(new T.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 10, curveSegments: 64 }));
  geo.computeBoundingBox();
  const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
  geo.center();
  const mono = new T.Group();
  const dMesh = new T.Mesh(geo, keep(new T.MeshPhysicalMaterial({ color: 0xffa552, metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.7, transparent: true, opacity: 0.58, depthWrite: false })));
  dMesh.renderOrder = 2; mono.add(dMesh);
  const outline = new T.LineSegments(keep(new T.EdgesGeometry(geo, 30)), keep(new T.LineBasicMaterial({ color: 0xffe0c2, transparent: true, opacity: 0.5 })));
  outline.renderOrder = 3; mono.add(outline);
  const glow = (c, k) => keep(new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 }));
  const core = new T.Mesh(keep(new T.SphereGeometry(0.2, 48, 48)), glow(0xffe8cc, 2.4)); core.position.x = -cx; mono.add(core);
  const pivot = new T.Group(); pivot.rotation.set(1.25, 0, -0.45);
  pivot.add(new T.Mesh(keep(new T.TorusGeometry(1.7, 0.03, 24, 220)), keep(new T.MeshPhysicalMaterial({ color: 0xffe0c2, metalness: 0.7, roughness: 0.18, clearcoat: 1, envMapIntensity: 1.5 }))));
  const moon = new T.Mesh(keep(new T.SphereGeometry(0.11, 32, 32)), glow(0xffe8cc, 2.2)); pivot.add(moon);
  mono.add(pivot);
  const pivot2 = new T.Group(); pivot2.rotation.set(1.1, 0.35, 0.5);
  pivot2.add(new T.Mesh(keep(new T.TorusGeometry(2.15, 0.012, 16, 220)), keep(new T.MeshBasicMaterial({ color: 0xffc98f, transparent: true, opacity: 0.25 }))));
  const sat = new T.Mesh(keep(new T.SphereGeometry(0.06, 24, 24)), glow(0xff5d73, 2.4)); pivot2.add(sat);
  mono.add(pivot2);
  scene.add(mono);

  const update = (t, tilt, scroll) => {
    const a = 1 + t * 1.1; moon.position.set(Math.cos(a) * 1.7, Math.sin(a) * 1.7, 0);
    const b = 3 - t * 0.7; sat.position.set(Math.cos(b) * 2.15, Math.sin(b) * 2.15, 0);
    pivot.rotation.z = -0.45 + Math.sin(t * 0.3) * 0.12;
    core.scale.setScalar(1 + Math.sin(t * 2) * 0.07);
    mono.position.y = Math.sin(t * 0.9) * 0.14;
    mono.rotation.set(tilt.x + Math.sin(t * 0.4) * 0.08, tilt.y + Math.sin(t * 0.45) * 0.45 + scroll * 1.2, 0);
    renderer.render(scene, camera);
  };
  const resize = (w, h) => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.z = w < 360 ? 7.4 : 6.6; camera.updateProjectionMatrix(); };
  const dispose = () => { disposables.forEach((d) => d.dispose && d.dispose()); envTex.dispose(); renderer.dispose(); };
  return { update, resize, dispose };
}

export default function Logo3D({ size = 320, scrollTurn = false, className = '' }) {
  const wrap = useRef(null);
  const canvasRef = useRef(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!canUseWebGL()) return undefined;
    let stopped = false; let raf = 0; let scene = null;
    const reduce = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
    const target = { x: 0, y: 0 }; const tilt = { x: 0, y: 0 };
    const onPointer = (e) => {
      const r = wrap.current?.getBoundingClientRect(); if (!r) return;
      target.y = Math.max(-0.6, Math.min(0.6, ((e.clientX - (r.left + r.width / 2)) / window.innerWidth) * 1.4));
      target.x = Math.max(-0.4, Math.min(0.4, ((e.clientY - (r.top + r.height / 2)) / window.innerHeight) * 0.9));
    };
    const fit = () => { const el = wrap.current; if (scene && el) scene.resize(el.clientWidth || size, el.clientHeight || size); };
    loadThree().then((T) => {
      if (stopped || !canvasRef.current) return;
      try { scene = buildScene(T, canvasRef.current); } catch { return; }
      fit(); setLive(true);
      let t = 0; let last = performance.now();
      const frame = (now) => {
        if (stopped) return;
        if (!document.hidden) {
          const dt = Math.min((now - last) / 1000, 0.05);
          if (!reduce) t += dt;
          tilt.x += (target.x - tilt.x) * 0.06; tilt.y += (target.y - tilt.y) * 0.06;
          const scroll = scrollTurn ? Math.min(1, window.scrollY / (window.innerHeight * 1.2)) : 0;
          scene.update(t, tilt, scroll);
        }
        last = now;
        if (!reduce) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }).catch(() => { /* stay on the SVG logo */ });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', fit);
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener('pointermove', onPointer); window.removeEventListener('resize', fit); if (scene) scene.dispose(); };
  }, [size, scrollTurn]);

  return (
    <div ref={wrap} className={`logo3d ${live ? 'live' : ''} ${className}`} style={{ width: size, height: size }}>
      <div className="logo3d-fallback"><OrbitGlass size={Math.round(size * 0.9)} /></div>
      <canvas ref={canvasRef} aria-hidden={!live} role="img" aria-label="DevOrbit logo in 3D" />
    </div>
  );
}
