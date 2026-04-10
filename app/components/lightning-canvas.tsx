"use client";

import { useEffect, useRef } from "react";

const PURPLE = "#7c6fff";
const BLUE = "#4285f4";

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

type Point = { x: number; y: number };

function smoothstep(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function buildMainPolyline(w: number, h: number): Point[] {
  const startX = random(w * 0.08, w * 0.92);
  const pts: Point[] = [{ x: startX, y: -20 }];
  let x = startX;
  let y = -20;
  const targetY = h * random(0.45, 0.92);
  while (y < targetY) {
    const dy = random(28, 72);
    const dx = random(-52, 52);
    x = clamp(x + dx, w * 0.02, w * 0.98);
    y = Math.min(y + dy, targetY + random(0, 40));
    pts.push({ x, y });
    if (pts.length > 24) break;
  }
  return pts;
}

function forkFrom(main: Point[], w: number, h: number): Point[] {
  if (main.length < 4) return [];
  const i = Math.floor(random(2, main.length - 2));
  const p = main[i]!;
  const branch: Point[] = [{ x: p.x, y: p.y }];
  let x = p.x;
  let y = p.y;
  const bias = Math.random() < 0.5 ? -1 : 1;
  const steps = Math.floor(random(4, 11));
  for (let s = 0; s < steps; s++) {
    x += bias * random(18, 48) + random(-22, 22);
    y += random(22, 58);
    x = clamp(x, 0, w);
    if (y > h + 40) break;
    branch.push({ x, y });
  }
  return branch.length > 1 ? branch : [];
}

type Bolt = {
  polylines: Point[][];
  startTime: number;
  duration: number;
};

function createBolt(w: number, h: number): Bolt {
  const main = buildMainPolyline(w, h);
  const polylines: Point[][] = [main];
  if (Math.random() < 0.88) {
    const b = forkFrom(main, w, h);
    if (b.length) polylines.push(b);
  }
  if (Math.random() < 0.55) {
    const b = forkFrom(main, w, h);
    if (b.length) polylines.push(b);
  }
  if (Math.random() < 0.35) {
    const b = forkFrom(main, w, h);
    if (b.length) polylines.push(b);
  }
  return {
    polylines,
    startTime: performance.now(),
    duration: random(520, 1280),
  };
}

function boltAlpha(bolt: Bolt, now: number) {
  const t = (now - bolt.startTime) / bolt.duration;
  if (t <= 0 || t >= 1) return 0;
  const fadeIn = 0.24;
  const fadeOut = 0.32;
  if (t < fadeIn) return smoothstep(t / fadeIn);
  if (t > 1 - fadeOut) return smoothstep((1 - t) / fadeOut);
  return 1;
}

function drawBolt(
  ctx: CanvasRenderingContext2D,
  bolt: Bolt,
  alpha: number,
  w: number,
) {
  if (alpha <= 0.01) return;

  const drawPass = (lineWidth: number, blur: number, color: string, aMul: number) => {
    ctx.save();
    ctx.globalAlpha = alpha * aMul;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = blur;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;

    for (const poly of bolt.polylines) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0]!.x, poly[0]!.y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i]!.x, poly[i]!.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  const g0 = ctx.createLinearGradient(0, 0, w, 0);
  g0.addColorStop(0, PURPLE);
  g0.addColorStop(0.55, BLUE);
  g0.addColorStop(1, PURPLE);

  ctx.save();
  ctx.globalAlpha = alpha * 0.45;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowBlur = 36;
  ctx.shadowColor = "rgba(124, 111, 255, 0.75)";
  ctx.strokeStyle = g0;
  for (const poly of bolt.polylines) {
    if (poly.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x, poly[0]!.y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i]!.x, poly[i]!.y);
    }
    ctx.stroke();
  }
  ctx.restore();

  drawPass(3.2, 22, "rgba(124, 111, 255, 0.95)", 0.9);
  drawPass(1.4, 14, BLUE, 0.95);
  drawPass(0.9, 6, "rgba(255,255,255,0.55)", 0.5);
}

export function LightningCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const raw = canvas.getContext("2d");
    if (!raw) return;
    const ctx: CanvasRenderingContext2D = raw;

    let bolts: Bolt[] = [];
    let nextStrike = performance.now() + random(400, 1200);
    let rafId = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    function resize() {
      const el = ref.current;
      if (!el) return;
      dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.floor(w * dpr);
      el.height = Math.floor(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      const c = el.getContext("2d");
      if (c) c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    function loop(now: number) {
      if (now >= nextStrike) {
        bolts.push(createBolt(w, h));
        nextStrike = now + random(400, 1200);
      }

      bolts = bolts.filter((b) => now - b.startTime < b.duration + 80);

      ctx.clearRect(0, 0, w, h);

      for (const b of bolts) {
        const a = boltAlpha(b, now);
        drawBolt(ctx, b, a, w);
      }

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      aria-hidden
    />
  );
}
