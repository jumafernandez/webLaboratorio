// Full-screen background: a carousel of the real blocks of the in-browser chain, a constellation of nodes passing
// packets, and drifting real hashes. "hero" shows everything; "juego" keeps only a dim backdrop behind the game.

import { chain } from "./cadena.js";
import { randHex } from "./util.js";

const CYAN = "196,181,253"; // lavender: the blockchain site palette
const VIOLET = "167,139,250";
const AMBER = "255,215,130";

export function startFondo(canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0;
  let H = 0;
  let mode = "hero";
  let heroAlpha = 1;
  let flash = 0;
  let running = true; // the caller wants it drawing (the game is open)
  let raf = 0;
  // Phones get fewer particles and a lower backing-store resolution: the backdrop is decoration.
  const small = matchMedia("(max-width: 760px)").matches;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const pool = () => (chain.length ? chain[Math.floor(Math.random() * chain.length)].hash : randHex(32));
  const drift = Array.from({ length: small ? 18 : 46 }, () => ({
    x: Math.random(),
    y: Math.random(),
    v: 0.00004 + Math.random() * 0.00012,
    a: 0.05 + Math.random() * 0.16,
    t: pool().slice(0, 8 + Math.floor(Math.random() * 12)),
  }));
  const stars = Array.from({ length: small ? 30 : 64 }, () => {
    const r = 0.55 + Math.random() * 0.45;
    const th = Math.random() * Math.PI * 2;
    return { r, th, ph: Math.random() * Math.PI * 2, c: Math.random() < 0.7 ? CYAN : VIOLET };
  });
  const packets = [];

  function drawBlocks(t, alpha) {
    const cx = W / 2;
    const cy = H * (W < 760 ? 0.3 : 0.36);
    const rx = Math.min(W * 0.34, 330);
    const ry = rx * 0.24;
    const blocks = chain.slice(-12);
    const n = Math.max(blocks.length, 1);
    const rot = reduce ? 0.6 : t * 0.00012;
    const items = blocks.map((b, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      return { b, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, z: (Math.sin(a) + 1) / 2, i };
    });
    // links follow chain order
    ctx.lineWidth = 1.2;
    for (let i = 1; i < items.length; i++) {
      const p = items[i - 1];
      const q = items[i];
      ctx.strokeStyle = `rgba(${CYAN},${0.12 + 0.25 * Math.min(p.z, q.z) * alpha})`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      const s = 0.55 + it.z * 0.5;
      const w = 92 * s;
      const h2 = 58 * s;
      const last = it.i === items.length - 1;
      const glow = last ? flash : 0;
      ctx.globalAlpha = alpha * (0.35 + it.z * 0.65);
      ctx.fillStyle = `rgba(26,16,56,0.92)`;
      ctx.strokeStyle = last ? `rgba(${AMBER},${0.6 + glow * 0.4})` : `rgba(${CYAN},0.65)`;
      ctx.lineWidth = last ? 2 : 1.2;
      if (glow > 0) {
        ctx.shadowColor = `rgba(${AMBER},${glow})`;
        ctx.shadowBlur = 30 * glow;
      }
      roundRect(it.x - w / 2, it.y - h2 / 2, w, h2, 9 * s);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(12 * s)}px Montserrat, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`#${it.b.n}`, it.x, it.y - 4 * s);
      ctx.fillStyle = `rgba(${CYAN},0.95)`;
      ctx.font = `${Math.round(10 * s)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`${it.b.hash.slice(0, 8)}…`, it.x, it.y + 12 * s);
    }
    ctx.globalAlpha = 1;
    const top = chain[chain.length - 1];
    if (top) {
      ctx.fillStyle = `rgba(233,228,255,${0.75 * alpha})`;
      ctx.font = "12px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`SHA-256 · bloque #${top.n} · nonce ${top.nonce} · dificultad 000`, cx, cy + ry + 54);
    }
    return { cx, cy, rx, ry };
  }

  function drawStars(t, geo, alpha) {
    const R = Math.min(W, H) * (W < 760 ? 0.42 : 0.4);
    const pts = stars.map((s) => {
      const th = s.th + (reduce ? 0 : t * 0.00003);
      return { x: geo.cx + Math.cos(th) * R * s.r * 1.25, y: geo.cy + Math.sin(th) * R * s.r * 0.62, s };
    });
    ctx.lineWidth = 0.6;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const d = dx * dx + dy * dy;
        if (d < 5200) {
          ctx.strokeStyle = `rgba(${CYAN},${0.1 * alpha})`;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    for (const p of pts) {
      const tw = 0.55 + 0.45 * Math.sin(t * 0.002 + p.s.ph);
      ctx.fillStyle = `rgba(${p.s.c},${0.75 * tw * alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // packets hop between random stars, like transactions gossiping across the network
    if (!reduce && Math.random() < 0.05 && packets.length < 10) {
      const a = Math.floor(Math.random() * pts.length);
      const b = Math.floor(Math.random() * pts.length);
      if (a !== b) packets.push({ a, b, k: 0 });
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.k += 0.012;
      if (p.k >= 1) {
        packets.splice(i, 1);
        continue;
      }
      const x = pts[p.a].x + (pts[p.b].x - pts[p.a].x) * p.k;
      const y = pts[p.a].y + (pts[p.b].y - pts[p.a].y) * p.k;
      ctx.fillStyle = `rgba(${AMBER},${0.9 * alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function frame(t) {
    if (!running || document.hidden) return;
    ctx.clearRect(0, 0, W, H);
    const target = mode === "hero" ? 1 : 0;
    heroAlpha = reduce ? target : heroAlpha + (target - heroAlpha) * 0.06;
    flash = Math.max(0, flash - 0.012);
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    for (const d of drift) {
      d.y -= reduce ? 0 : d.v * 16;
      if (d.y < -0.03) {
        d.y = 1.03;
        d.x = Math.random();
        d.t = pool().slice(0, 8 + Math.floor(Math.random() * 12));
      }
      ctx.fillStyle = `rgba(${CYAN},${d.a * (0.45 + 0.55 * heroAlpha)})`;
      ctx.fillText(d.t, d.x * W, d.y * H);
    }
    if (heroAlpha > 0.02) {
      const geo = drawBlocks(t, heroAlpha);
      drawStars(t, geo, heroAlpha);
    }
    // Reduced motion: same scene, standing still, refreshed slowly (new blocks, resizes).
    raf = reduce ? setTimeout(() => requestAnimationFrame(frame), 700) : requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const cancel = () => {
    cancelAnimationFrame(raf);
    clearTimeout(raf);
  };
  // Hidden tab: stop the loop entirely (the reduced-motion path uses timers, which keep running in background tabs).
  document.addEventListener("visibilitychange", () => {
    cancel();
    if (running && !document.hidden) raf = requestAnimationFrame(frame);
  });

  return {
    setMode(m) {
      mode = m;
    },
    newBlock() {
      flash = 1;
    },
    stop() {
      running = false;
      cancel();
      ro.disconnect();
    },
    start() {
      if (running) return;
      running = true;
      ro.observe(canvas);
      cancel();
      raf = requestAnimationFrame(frame);
    },
  };
}
