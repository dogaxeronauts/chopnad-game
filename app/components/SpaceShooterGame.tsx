"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * SpaceShooterGame.tsx — Next.js + React (TypeScript)
 * - principal-dev tarzı: asla if/else/for deyimi yok
 * - fonksiyonel/declarative akış: map/filter/reduce, boolean arithmetic, short-circuit
 * - dinamik zorluk, rotten & knife power-up, kompakt order bubble
 * - tek dosya, düşük yan etki
 */

/* ---------------------------- Sabitler & Tipler ---------------------------- */

type VegDef = {
  key: string;
  src: string;
  hits: number;
  score: number;
  label: string;
  style?: React.CSSProperties;
  img?: HTMLImageElement;
};

type Order = {
  items: Map<string, number>;
  originalItems: Map<string, number>;
  deadline: number;
  totalDur: number;
  chopped: Map<string, number>;
};

type PackItem = { key: string; hp: number; def: VegDef; idx: number; dead?: boolean };
type Pack = { x: number; items: PackItem[]; el?: HTMLDivElement };

const SCENE_W = 1152;
const COUNTER_Y = 490;
const PACK_Y = COUNTER_Y - 14;
const SPEED = 3.2;
const CHOP_BASE = 60;

const VEG_W = 72;
const VEG_H = 72;
const GAP = 8;
const PACK_PAD = 10;
const MAX_FLIGHTS = 28;

const safeStyle = (s?: React.CSSProperties) =>
  s ? { ...s, transformOrigin: "center", maxWidth: "100%", maxHeight: "100%" } : undefined;

const px = (n: number) => `${n}px`;
const now = () => performance.now();
const ceilSec = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const intersect = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
  !(ax + aw < bx || bx + bw < ax || ay + ah < by || by + bh < ay);

/* ---------------------- Dinamik Zorluk & Mekanikler ----------------------- */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const rand = () => Math.random();
const chance = (p: number) => rand() < p;

type Difficulty = {
  belt: number;
  spawnMs: number;
  packCap: number;
  rottenRate: number; // 0..1
  powerRate: number; // 0..1
  orderSize: number; // min parça
  orderVar: number; // ekstra rastgele parça
};

const diffCurve = (lv: number): Difficulty => {
  const t = clamp01(lv / 12);
  return {
    belt: lerp(2.0, 4.2, t),
    spawnMs: Math.round(lerp(850, 520, t)),
    packCap: 2 + (lv > 6 ? 1 : 0),
    rottenRate: lerp(0.0, 0.3, t),
    powerRate: lerp(0.02, 0.08, t),
    orderSize: Math.round(lerp(2, 3, t)),
    orderVar: Math.round(lerp(2, 4, t)),
  };
};

type SpecialKind = "rotten" | "knife";
const asSpecial = (def: VegDef, kind: SpecialKind): VegDef =>
  kind === "rotten"
    ? { ...def, key: `rotten:${def.key}`, label: `Rotten ${def.label}`, score: -Math.max(10, def.score), hits: 1 }
    : { ...def, key: `knife`, label: `Knife Power`, score: 0, hits: 1, src: "/knife.png" };

const isRotten = (k: string) => k.startsWith("rotten:");
const isKnife = (k: string) => k === "knife";

const spanOf = (p: Pack) => PACK_PAD * 2 + p.items.length * VEG_W + (p.items.length - 1) * GAP;

/* -------------------------------- Bileşen --------------------------------- */

const SpaceShooterGame: React.FC = () => {
  /* ------------------------------- Refs/State ------------------------------ */
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const chefRef = useRef<HTMLImageElement | null>(null);
  const orderChefRef = useRef<HTMLImageElement | null>(null);
  const pileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreRef = useRef<HTMLSpanElement | null>(null);
  const comboRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const gameoverRef = useRef<HTMLDivElement | null>(null);

  const dprRef = useRef(1);
  const [packs, setPacks] = useState<Pack[]>([]);
  const packsRef = useRef<Pack[]>([]);
  packsRef.current = packs;

  const [order, setOrder] = useState<Order | null>(null);
  const orderRef = useRef<Order | null>(null);
  orderRef.current = order;

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState("--");

  const leftRef = useRef(false);
  const rightRef = useRef(false);
  const choppingRef = useRef(false);
  const runningRef = useRef(true);

  const rrIndexRef = useRef(0);
  const rrAllIndexRef = useRef(0);

  const lastSpawnRef = useRef(0);
  const lastChopRef = useRef(0);
  const chefXRef = useRef(300);

  const pileCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fxCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const acRef = useRef<AudioContext | null>(null);

  const levelRef = useRef(0);
  const ordersDoneRef = useRef(0);
  const heatRef = useRef(0);
  const powerUntilRef = useRef(0);

  /* -------------------------------- Assetler ------------------------------- */
  const VegDefs = useMemo<VegDef[]>(
    () => [
      { key: "broccoli", src: "/broccoli.png", hits: 2, score: 30, label: "Broccoli" },
      { key: "pepper", src: "/californian_pepper.png", hits: 2, score: 30, label: "Pepper" },
      { key: "carrot", src: "/carrot.png", hits: 2, score: 25, label: "Carrot", style: { transform: "scale(1.8) rotate(90deg)" } },
      { key: "cucumber", src: "/cucumber.png", hits: 2, score: 25, label: "Cucumber" },
      { key: "eggplant", src: "/eggplant.png", hits: 3, score: 40, label: "Eggplant" },
      { key: "mushroom", src: "/mushroom.png", hits: 1, score: 20, label: "Mushroom" },
      { key: "onion", src: "/onion.png", hits: 2, score: 25, label: "Onion" },
      { key: "potato", src: "/potato.png", hits: 2, score: 25, label: "Potato" },
      { key: "pumpkin", src: "/pumpkin.png", hits: 3, score: 45, label: "Pumpkin", style: { transform: "scale(1.6)" } },
      { key: "tomato", src: "/tomato.png", hits: 1, score: 25, label: "Tomato" },
      { key: "tomato1", src: "/tomato1.png", hits: 1, score: 25, label: "Tomato" },
      { key: "watermelon", src: "/watermelon.png", hits: 5, score: 100, label: "Watermelon", style: { transform: "scale(1.9)" } },
    ],
    []
  );

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.src = src;
    });

  /* -------------------------------- Sesler --------------------------------- */
  const beep = (f = 880, d = 0.08, t = 0) =>
    (acRef.current &&
      (() => {
        const ac = acRef.current!;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + d);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t);
        o.stop(ac.currentTime + t + d + 0.02);
      })()) ||
    undefined;

  const ding = () => (beep(1046, 0.08, 0), beep(1318, 0.09, 0.09));

  /* ------------------------------- Canvas DPI ------------------------------ */
  useEffect(() => {
    const pile = pileCanvasRef.current;
    const fx = fxCanvasRef.current;
    const pileCtx = pile && pile.getContext("2d");
    const fxCtx = fx && fx.getContext("2d");
    pileCtxRef.current = pileCtx || null;
    fxCtxRef.current = fxCtx || null;

    const resize = () => {
      const w = (pile?.clientWidth || 0) | 0;
      const h = (pile?.clientHeight || 0) | 0;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      dprRef.current = dpr;
      [pile, fx]
        .filter(Boolean)
        .forEach((c) => {
          (c as HTMLCanvasElement).width = w * dpr;
          (c as HTMLCanvasElement).height = h * dpr;
        });
      pileCtxRef.current && (pileCtxRef.current.imageSmoothingEnabled = false);
      fxCtxRef.current && (fxCtxRef.current.imageSmoothingEnabled = false);
    };

    addEventListener("resize", resize);
    resize();
    return () => removeEventListener("resize", resize);
  }, []);

  /* ------------------------- Görseller → Order → Loop ---------------------- */
  useEffect(() => {
    Promise.all(
      VegDefs.map((d) => loadImage(d.src).then((img) => Object.assign(d, { img })))
    ).then(() => {
      newOrder();
      requestAnimationFrame(loop);
    });
  }, [VegDefs]);

  /* --------------------------------- Input --------------------------------- */
  useEffect(() => {
    const resumeAC = () =>
      (acRef.current && acRef.current.state === "suspended" && acRef.current.resume()) || undefined;

    const keyMap: Record<string, "left" | "right" | "chop" | undefined> = {
      a: "left",
      A: "left",
      ArrowLeft: "left",
      d: "right",
      D: "right",
      ArrowRight: "right",
      Space: "chop",
    };

    const onDown = (e: KeyboardEvent) =>
      ((e.repeat && keyMap[e.key] !== "chop") && true) ||
      ((keyMap[e.key] === "left" && (leftRef.current = true)) ||
        (keyMap[e.key] === "right" && (rightRef.current = true)) ||
        (((keyMap[e.key] || (e.code === "Space" && "chop")) === "chop") &&
          (e.preventDefault(), chop())),
      resumeAC());

    const onUp = (e: KeyboardEvent) =>
      ((keyMap[e.key] === "left" && (leftRef.current = false)) ||
        (keyMap[e.key] === "right" && (rightRef.current = false))) || undefined;

    const onMouse = (e: MouseEvent) => (e.button === 0 && chop()) || undefined;

    addEventListener("keydown", onDown);
    addEventListener("keyup", onUp);
    sceneRef.current?.addEventListener("mousedown", onMouse);
    try {
      acRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      acRef.current = null;
    }
    return () => {
      removeEventListener("keydown", onDown);
      removeEventListener("keyup", onUp);
      sceneRef.current?.removeEventListener("mousedown", onMouse);
    };
  }, []);

  /* ---------------------------- Order Bubble UI ---------------------------- */
  const anchorRect = () => {
    const anchor =
      (orderChefRef.current &&
        orderChefRef.current.style.display !== "none" &&
        orderChefRef.current) ||
      chefRef.current;
    const s = sceneRef.current?.getBoundingClientRect();
    const a = anchor?.getBoundingClientRect();
    return s && a
      ? { left: a.left - s.left, top: a.top - s.top, width: a.width, height: a.height }
      : null;
  };

  const bubbleText = () => {
    const remain = orderRef.current && ceilSec(orderRef.current.deadline - now());
    const items =
      orderRef.current &&
      Array.from(orderRef.current.originalItems.entries())
        .map(([k, c]) => {
          const v = VegDefs.find((x) => x.key === k);
          const done = (orderRef.current?.chopped.get(k) || 0) as number;
          return v ? `<img class="mini" src="${v.src}" alt=""> ${done}/${c}` : "";
        })
        .filter(Boolean)
        .join(" · ");
    return `<span style="font-weight:600">Order</span> ${items || ""} <span style="opacity:.7">⏱ ${remain ?? "--"}s</span>`;
  };

  const updateBubble = () => {
    const b = bubbleRef.current;
    const r = anchorRect();
    b &&
      orderRef.current &&
      ((b.innerHTML = bubbleText()),
      (b.style.display = "block"),
      r &&
        ((b.style.left = px(r.left + (b.offsetWidth ? (r.width - b.offsetWidth) / 2 : 0))),
        (b.style.top = px(r.top - (b.offsetHeight || 0) - 10))));
    (!orderRef.current && b) && (b.style.display = "none");
  };

  /* ---------------------------- Tepeleme / Canvas -------------------------- */
  const pilesRef = useRef<Map<string, { x: number; y: number; count: number }>>(new Map());
  const CLIPS: number[][][] = [
    [
      [0, 10],
      [90, 0],
      [100, 70],
      [20, 100],
    ],
    [
      [15, 0],
      [100, 10],
      [85, 90],
      [0, 70],
    ],
    [
      [0, 20],
      [70, 0],
      [100, 40],
      [30, 100],
    ],
    [
      [10, 10],
      [90, 20],
      [70, 100],
      [0, 80],
    ],
    [
      [0, 0],
      [100, 20],
      [80, 100],
      [10, 70],
    ],
  ];

  const clip = (ctx: CanvasRenderingContext2D, poly: number[][], w: number, h: number) => {
    ctx.beginPath();
    poly.forEach(([px, py], i) =>
      i
        ? ctx.lineTo(((px - 50) / 100) * w, ((py - 50) / 100) * h)
        : ctx.moveTo(((px - 50) / 100) * w, ((py - 50) / 100) * h)
    );
    ctx.closePath();
  };

  const pileOf = (key: string, startX: number) =>
    pilesRef.current.get(key) ||
    (pilesRef.current.set(key, { x: startX, y: COUNTER_Y + 42, count: 0 }), pilesRef.current.get(key)!);

  type Flight = { def: VegDef; sx: number; sy: number; tx: number; ty: number; t: number; clipIdx: number; rot: number; size: number };
  const flightsRef = useRef<Flight[]>([]);
  const pushFlight = (f: Flight) => {
    const a = flightsRef.current;
    a.push(f);
    a.length > MAX_FLIGHTS && a.shift();
  };

  const launchFlight = (def: VegDef, sx: number, sy: number, tx: number, ty: number, idx: number) => {
    const clipIdx = idx % CLIPS.length;
    const rot = (((idx * 37) % 120) - 60) * (Math.PI / 180);
    const size = 30 + (idx % 3) * 2;
    pushFlight({ def, sx, sy, tx, ty, t: 0, clipIdx, rot, size });
  };

  const drawSliceToPile = (def: VegDef, x: number, y: number, size: number, clipIdx: number, rot: number) => {
    const pileCtx = pileCtxRef.current;
    const dpr = dprRef.current;
    const w = size * dpr,
      h = size * dpr;
    pileCtx &&
      def.img &&
      (pileCtx.save(),
      pileCtx.translate(x * dpr, y * dpr),
      pileCtx.rotate(rot),
      clip(pileCtx, CLIPS[clipIdx], w, h),
      pileCtx.clip(),
      pileCtx.drawImage(def.img, -w / 2, -h / 2, w, h),
      pileCtx.restore());
  };

  const stepFlights = (dt: number) => {
    const fxCtx = fxCtxRef.current;
    fxCtx && fxCtx.clearRect(0, 0, fxCtx.canvas.width, fxCtx.canvas.height);
    const still: Flight[] = [];
    flightsRef.current.forEach((f) => {
      const nt = Math.min(1, f.t + dt * 0.0045);
      const ease = nt < 0.5 ? 2 * nt * nt : 1 - 2 * (1 - nt) * (1 - nt);
      const mx = f.sx + (f.tx - f.sx) * nt;
      const my = f.sy + (f.ty - f.sy) * ease;
      const dpr = dprRef.current;
      const ctx = fxCtxRef.current;
      ctx &&
        f.def.img &&
        (ctx.save(),
        ctx.translate(mx * dpr, my * dpr),
        ctx.rotate(f.rot),
        clip(ctx, CLIPS[f.clipIdx], f.size * dpr, f.size * dpr),
        ctx.clip(),
        ctx.drawImage(
          f.def.img,
          -(f.size * dpr) / 2,
          -(f.size * dpr) / 2,
          f.size * dpr,
          f.size * dpr
        ),
        ctx.restore());
      (nt < 1 && still.push({ ...f, t: nt })) || drawSliceToPile(f.def, f.tx, f.ty, f.size, f.clipIdx, f.rot);
    });
    flightsRef.current = still;
  };

  /* ------------------------------- Paketler -------------------------------- */
  const roundRobinPick = (): VegDef => {
    const fallback = () => VegDefs[(rrAllIndexRef.current++) % VegDefs.length];

    const diff = diffCurve(levelRef.current);
    const keys =
      (orderRef.current &&
        Array.from(orderRef.current.items.entries())
          .filter(([, v]) => v > 0)
          .map(([k]) => k)) ||
      [];

    const key = (keys.length && keys[(rrIndexRef.current++) % keys.length]) || undefined;
    const base = (key && VegDefs.find((d) => d.key === key)) || fallback();

    const specialPick =
      (chance(diff.powerRate) && asSpecial(base, "knife")) ||
      (chance(diff.rottenRate) && asSpecial(base, "rotten")) ||
      null;

    return specialPick || base;
  };

  const spawnPack = () => {
    const scene = sceneRef.current;
    const W = (scene?.clientWidth || SCENE_W) + 0;
    const startX = W + 120;

    const diff = diffCurve(levelRef.current);
    const cap  = diff.packCap;

    const items = Array.from({ length: cap }, (_, idx) => {
      const def = roundRobinPick();
      const hp  = isKnife(def.key) ? 1 : powerUntilRef.current > now() ? 1 : def.hits;
      return { key: def.key, hp, def, idx } as PackItem;
    });

    const el = typeof document !== "undefined" ? document.createElement("div") : null;

    // minik şerit ofseti (okunurluk)
    const laneOffset = ((rrAllIndexRef.current % 3) - 1) * 4; // -4, 0, +4 px

    el &&
      ((el.className = "pack"),
      (el.style.transform = `translate3d(${startX}px, ${PACK_Y + laneOffset}px, 0)`),
      items.forEach(v => {
        const slot = document.createElement("div");
        slot.className = "slot";
        // inline stil ile taşmayı kesin (CSS ekleyemiyorsan)
        Object.assign(slot.style, {
          width: "72px", height: "72px",
          display: "grid", placeItems: "center",
          overflow: "hidden", borderRadius: "6px",
        } as CSSStyleDeclaration);

        const img = document.createElement("img");
        img.className = "veg";
        img.src = v.def.src;
        img.alt = v.def.label;
        v.def.style && Object.assign(img.style, safeStyle(v.def.style));
        slot.dataset.knife = isKnife(v.def.key) ? "1" : "0";

        slot.appendChild(img);
        el.appendChild(slot);
      }),
      scene?.appendChild(el));

    setPacks(prev => [...prev, { x: startX, items, el: el || undefined }]);
  };

  const chopZone = () => ({ x: chefXRef.current + 180, y: COUNTER_Y, w: 220, h: 110 });

  /* --------------------------------- Chop ---------------------------------- */
  const chop = () => {
    const cd = powerUntilRef.current > now() ? 36 : CHOP_BASE;
    const t = now();
    (t - lastChopRef.current < cd && true) ||
      ((lastChopRef.current = t),
      (choppingRef.current && true) ||
        ((choppingRef.current = true),
        (chefRef.current &&
          ((() => {
            const prev = chefRef.current!.src;
            chefRef.current!.src = "/sef3.png";
            setTimeout(() => {
              chefRef.current && (chefRef.current.src = prev);
              choppingRef.current = false;
            }, cd);
          })(),
          undefined)),
        handleHit()));
  };

  const handleHit = () => {
    const zone = chopZone();
    const res = packsRef.current.reduce<{ item?: PackItem; pack?: Pack }>(
      (acc, p) =>
        acc.item
          ? acc
          : p.items.reduce((acc2, v) => {
              const base = p.x + PACK_PAD;
              const cx = base + v.idx * (VEG_W + GAP) + VEG_W / 2;
              const cy = PACK_Y + VEG_H / 2;
              const hx = cx - VEG_W / 2,
                hy = cy - VEG_H / 2;
              const hit = intersect(zone.x, zone.y, zone.w, zone.h, hx, hy, VEG_W, VEG_H);
              return acc2.item || !hit ? acc2 : { item: v, pack: p };
            }, acc),
      {}
    );

    (res.item && res.pack) || ((setCombo(0), beep(220, 0.06), (heatRef.current = Math.min(1, heatRef.current + 0.08))), undefined);

    res.item &&
      res.pack &&
      ((res.item.hp--, beep(640, 0.05)),
      sliceAndPile(res.item, res.pack),
      updateScore(res.item),
      removeWhenDead(res.item, res.pack),
      undefined);
  };

  const sliceAndPile = (hitItem: PackItem, hitPack: Pack) => {
    const sx = hitPack.x + PACK_PAD + hitItem.idx * (VEG_W + GAP) + VEG_W / 2;
    const sy = PACK_Y + VEG_H / 2;
    const pile = pileOf(hitItem.key.replace(/^rotten:/, ""), sx);
    const idxBase = pile.count;
    const pieces = 2 + (idxBase % 2);
    Array.from({ length: pieces }, (_, i) => idxBase + i).forEach((idx) => {
      const tx = pile.x + (idx % 2 === 0 ? -1 : 1) * (16 + (idx % 3) * 4);
      const ty = pile.y - idx * 0.45 - ((idx % 5) * 1.2);
      launchFlight(hitItem.def, sx, sy, tx, ty, idx);
      pile.count++;
    });
  };

  const updateScore = (hitItem: PackItem) => {
    const base = hitItem.def.score ?? 0;
    setScore((s) => s + base);
    const contributes = orderRef.current && orderRef.current.items.has(hitItem.key.replace(/^rotten:/, ""));
    contributes || (setCombo(0), undefined);
  };

  const removeWhenDead = (hitItem: PackItem, hitPack: Pack) =>
    (hitItem.hp <= 0 &&
      ((hitItem.dead = true),
      hitPack.el &&
        (hitPack.el.children[hitItem.idx] as HTMLElement | undefined) &&
        (((hitPack.el.children[hitItem.idx] as HTMLElement).style.visibility = "hidden"), undefined),

      isKnife(hitItem.key) &&
        ((powerUntilRef.current = now() + 6000), ding(), undefined),

      isRotten(hitItem.key) && ((setScore((s) => s - 30), setCombo(0)), undefined),

      (!isKnife(hitItem.key) && !isRotten(hitItem.key) && orderRef.current) &&
        (orderRef.current.items.has(hitItem.key) &&
          (() => {
            const add = (hitItem.def.score || 50) * 3;
            setScore((s) => s + add + combo * 25);
            setCombo((c) => Math.min(c + 1, 99));
            const k = hitItem.key;
            const ch = orderRef.current!.chopped.get(k) || 0;
            orderRef.current!.chopped.set(k, ch + 1);
            const left = Math.max(0, (orderRef.current!.items.get(k) || 0) - 1);
            orderRef.current!.items.set(k, left);
            updateBubble();
            finalizeOrderWhenDone();
          })(),
        undefined)), // <-- add comma here
    undefined);

  /* ------------------------------ Sipariş Üretimi -------------------------- */
  const newOrder = () => {
    const pileCtx = pileCtxRef.current;
    const fxCtx = fxCtxRef.current;
    pileCtx && pileCtx.clearRect(0, 0, pileCtx.canvas.width, pileCtx.canvas.height);
    fxCtx && fxCtx.clearRect(0, 0, fxCtx.canvas.width, fxCtx.canvas.height);
    pilesRef.current.clear();

    const lv = levelRef.current;
    const diff = diffCurve(lv);

    const n = 2 + Math.floor(rand() * 3);
    const pool = [...VegDefs].sort(() => rand() - 0.5).slice(0, n);
    const originalItems = new Map(pool.map((v) => [v.key, diff.orderSize + Math.floor(rand() * diff.orderVar)]));
    const items = new Map(Array.from(originalItems.entries()));
    const dur = 20 + Math.floor(rand() * 7) - Math.min(lv, 8);

    const created: Order = {
      items,
      originalItems,
      deadline: now() + Math.max(12, dur) * 1000,
      totalDur: Math.max(12, dur),
      chopped: new Map(pool.map((v) => [v.key, 0])),
    };

    rrIndexRef.current = 0;
    setOrder(created);
    (orderRef.current = created);
    ding();
    spawnPack();
    lastSpawnRef.current = now();
    updateBubble();
  };

  const finalizeOrderWhenDone = () =>
    orderRef.current &&
    Array.from(orderRef.current.items.values()).every((v) => v === 0) &&
    (() => {
      const remain = ceilSec(orderRef.current!.deadline - now());
      const deliveryBonus = 200 + remain * 10;
      setScore((s) => s + deliveryBonus);

      const b = bubbleRef.current;
      b &&
        ((b.textContent = "✅ Teslim!"),
        (b.style.background = "#d4ffb2"),
        (b.style.color = "#222"),
        (b.style.borderColor = "#4caf50"));

      setTimeout(() => {
        const bb = bubbleRef.current;
        bb &&
          ((bb.style.background = "#fff"),
          (bb.style.color = "#000"),
          (bb.style.borderColor = "#000"));
        ordersDoneRef.current += 1;
        levelRef.current = Math.floor(ordersDoneRef.current / 2) + Math.floor(score / 700);
        newOrder();
      }, 700);
    })();

  /* ------------------------------- Oyun Döngüsü ---------------------------- */
  const loop = (ts: number) => {
    const diffL = diffCurve(levelRef.current);

    // hareket
    const dx = (Number(rightRef.current) - Number(leftRef.current)) * SPEED;
    chefXRef.current = clamp(chefXRef.current + dx, 60, 820);
    chefRef.current && (chefRef.current.style.left = px(chefXRef.current));

    // süre & bitiş
    orderRef.current &&
      (() => {
        const remain = ceilSec(orderRef.current!.deadline - ts);
        setTimeLeft(remain + "s");
        (remain <= 0 &&
          (Array.from(orderRef.current!.items.values()).some((v) => v > 0)
            ? endGame()
            : newOrder())) || undefined;
      })();

    // paket akışı (dinamik spawn)
    (orderRef.current && ts - lastSpawnRef.current > diffL.spawnMs && (spawnPack(), (lastSpawnRef.current = ts))) || undefined;

    packsRef.current.forEach((p) => {
      p.x -= diffL.belt;
      p.el && (p.el.style.transform = `translate3d(${p.x}px, ${PACK_Y}px, 0)`);
    });

    const alivePacks = packsRef.current.filter((p) => p.x > -spanOf(p));
    (alivePacks.length !== packsRef.current.length && setPacks(alivePacks)) || undefined;

    // miss heat — yavaş sönüm
    heatRef.current = Math.max(0, heatRef.current - 0.002);
    (heatRef.current > 0.7 && setScore((s) => s - 0.2)) || undefined;

    // uçușlar
    stepFlights(16);

    updateBubble();
    runningRef.current && requestAnimationFrame(loop);
  };

  const endGame = () => {
    runningRef.current = false;
    gameoverRef.current && (gameoverRef.current.style.display = "flex");
  };

  /* -------------------------------- HUD Sync ------------------------------- */
  useEffect(() => {
    scoreRef.current && (scoreRef.current.textContent = String(score));
  }, [score]);

  useEffect(() => {
    comboRef.current && (comboRef.current.textContent = String(combo));
  }, [combo]);

  useEffect(() => {
    timerRef.current && (timerRef.current.textContent = String(timeLeft));
  }, [timeLeft]);

  /* --------------------------------- Render -------------------------------- */
  return (
    <div
      style={{
        background: "#000",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        color: "#fff",
        fontFamily: "monospace",
        minHeight: "100vh",
      }}
    >
      <div className="scene" id="scene" ref={sceneRef} style={{ position: "relative", width: `${SCENE_W}px`, height: "768px", imageRendering: "pixelated", overflow: "hidden" }}>
        {/* arka plan */}
        <img className="bg" src="/06dd7a66-daee-4537-bd4d-81f864a503f5.png" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />

        {/* aşçı */}
        <img
          id="chef"
          ref={chefRef}
          src="/sef1.png"
          alt="chef"
          style={{ position: "absolute", left: "300px", bottom: "170px", width: "512px", height: "512px", zIndex: 5, imageRendering: "pixelated" }}
        />

        {/* tepeleme & efekt */}
        <canvas
          id="pileCanvas"
          ref={pileCanvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 8, pointerEvents: "none", imageRendering: "pixelated" }}
        />
        <canvas
          id="fxCanvas"
          ref={fxCanvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 8, pointerEvents: "none", imageRendering: "pixelated" }}
        />

        {/* sipariş aşçısı */}
        <img
          id="orderChef"
          ref={orderChefRef}
          src="/order_chef.png"
          alt="order-chef"
          onError={(e) => ((e.currentTarget.style.display = "none"), undefined)}
          style={{ position: "absolute", right: "20px", bottom: "170px", width: "360px", height: "auto", zIndex: 8, imageRendering: "pixelated" }}
        />

        {/* ön yüz */}
        <img className="front" src="/tezgah_on_front_face.png" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 7, pointerEvents: "none" }} />

        {/* HUD */}
        <div className="hud" style={{ position: "absolute", top: "10px", left: "10px", zIndex: 9, fontWeight: "bold", fontSize: "18px" }}>
          {"Score: "} <span id="score" ref={scoreRef}>0</span> {" | "}
          {"Combo: "} <span id="combo" ref={comboRef}>0</span> {" | "}
          {"Time: "} <span id="orderTimer" ref={timerRef}>--</span>
        </div>

        {/* bubble */}
        <div
          id="orderBubble"
          ref={bubbleRef}
          className="orderBubble"
          style={{
            position: "absolute",
            zIndex: 9,
            background: "#fff",
            color: "#000",
            border: "2px solid #000",
            padding: "6px 8px",
            borderRadius: "12px",
            whiteSpace: "nowrap",
            minWidth: "120px",
            minHeight: "36px",
            display: "none",
            boxShadow: "0 2px 8px #0002",
            imageRendering: "pixelated",
            fontSize: "13px",
          } as any}
        />

        {/* game over */}
        <div
          id="gameover"
          ref={gameoverRef}
          style={{
            position: "absolute",
            inset: 0,
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            background: "rgba(0,0,0,.85)",
            flexDirection: "column",
            gap: "12px",
            fontSize: "28px",
          }}
        >
          <div>GAME OVER</div>
          <button
            onClick={() => {
              packsRef.current.forEach((p) => p.el && p.el.parentElement && p.el.parentElement.removeChild(p.el));
              setPacks([]);
              setScore(0);
              setCombo(0);
              setOrder(null);
              (orderRef.current = null);
              runningRef.current = true;
              lastSpawnRef.current = 0;
              bubbleRef.current && (bubbleRef.current.style.display = "none");
              pilesRef.current.clear();
              const pileCtx = pileCtxRef.current;
              const fxCtx = fxCtxRef.current;
              pileCtx && pileCtx.clearRect(0, 0, pileCtx.canvas.width, pileCtx.canvas.height);
              fxCtx && fxCtx.clearRect(0, 0, fxCtx.canvas.width, fxCtx.canvas.height);
              (gameoverRef.current && (gameoverRef.current.style.display = "none")) || undefined;
              newOrder();
              requestAnimationFrame(loop);
            }}
            style={{ fontFamily: "inherit", padding: "8px 14px" }}
          >
            Retry
          </button>
        </div>
      </div>

      <style jsx global>{`
        .pack {
          position: absolute;
          z-index: 6;
          display: flex;
          gap: 8px;
          align-items: center;
          padding: 6px 10px;
          border: 2px solid #333;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          box-shadow: 0 2px 0 #000 inset;
          will-change: transform;
        }
        .veg {
          width: 72px;
          height: 72px;
          object-fit: contain;
          image-rendering: pixelated;
          filter: drop-shadow(0 2px 0 #000);
          user-select: none;
          pointer-events: none;
        }
        .orderBubble:after {
          content: "";
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: -10px;
          width: 0;
          height: 0;
          border-left: 10px solid transparent;
          border-right: 10px solid transparent;
          border-top: 10px solid #fff;
        }
        .orderBubble .mini {
          height: 16px;
          width: 16px;
          object-fit: contain;
          image-rendering: pixelated;
          vertical-align: middle;
        }
      `}</style>
    </div>
  );
};

export default SpaceShooterGame;