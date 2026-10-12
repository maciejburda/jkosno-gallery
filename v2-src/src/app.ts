/* Galeria Jana Kosno — v2 (TypeGPU / WebGPU). Game logic and UI are ported 1:1 from v1 (3d.html);
   rendering goes through render/renderer.ts. Loaded by main.ts once WebGPU is known to work. */
import type { TgpuRoot } from 'typegpu';
import { mat4 } from 'wgpu-matrix';
import { KOSNO, makeT, setLang, tGroup, tCat, tSup, tTitle, initConsentBanner, resetConsent, type Item, type Lang } from './shared/data.ts';
import {
  rooms, placements, ROMAN, EYE, END_X, DOOR_H, publicCount, plugWall, walls, KEY_BLUE, KEY_ORANGE,
  normalOf, rightOf, roomAt, SECRET_ROOM,
} from './world/layout.ts';
import { buildWorld } from './world/build.ts';
import { createRenderer, type InstanceRec, type Tier } from './render/renderer.ts';
import { createPaintingTextures, HiResPool, type PaintingInstanceRef } from './textures/paintings.ts';
import { S, isTouch } from './game/state.ts';
import { step, startFocus, endFocus, teleportTo, doJump, findItem } from './game/player.ts';
import { pick, FOV } from './game/picking.ts';
import { track } from './game/analytics.ts';
import { createForest, type Forest } from './forest/forest.ts';
import { PORTAL } from './forest/layout.ts';

export async function startApp(root: TgpuRoot, lang: Lang) {
  const T = makeT(lang);
  const tier: Tier = isTouch ? 'low' : 'high';
  const q = new URLSearchParams(location.search);
  const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

  /* ============================== language & options (v1) ============================== */
  S.invY = localStorage.getItem('kosno-invy') === '1';
  document.documentElement.lang = lang;
  document.title = T('title3d');
  {
    const set = (id: string, html: string) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
    set('in-kicker', T('introKicker')); set('in-sub', T('introSub', { n: publicCount })); set('in-howto', T('howto'));
    set('c1h', T('cWalkH')); set('c1p', T('cWalkP')); set('c2h', T('cLookH')); set('c2p', T('cLookP'));
    set('c3h', T('cArtH')); set('c3p', T('cArtP')); set('c4h', T('cRoomsH')); set('c4p', T('cRoomsP'));
    set('t1h', T('tWalkH')); set('t1p', T('tWalkP')); set('t2h', T('tLookH')); set('t2p', T('tLookP'));
    set('t3h', T('tArtH')); set('t3p', T('tArtP'));
    set('invy-l', T('invertY')); set('enterbtn', T('enter'));
    set('introback', T('back')); set('brand-sub', T('brand3dSub')); set('brand-back', T('backTop'));
    set('hint', T('hint')); set('privacy3d', T('privacy')); set('v1link', T('v1link'));
    $('privacy3d').addEventListener('click', e => { e.preventDefault(); resetConsent(T); });
    initConsentBanner(T);
    $('lang-' + lang).classList.add('on');
    $('lang-pl').addEventListener('click', () => { if (lang !== 'pl') setLang('pl'); });
    $('lang-en').addEventListener('click', () => { if (lang !== 'en') setLang('en'); });
    const invy = $<HTMLInputElement>('invy');
    invy.checked = S.invY;
    invy.addEventListener('change', () => { S.invY = invy.checked; localStorage.setItem('kosno-invy', S.invY ? '1' : '0'); });
    /* switch to the classic (WebGL) gallery — remembered, so links keep opening it */
    const legacy = new URLSearchParams(location.search); legacy.set('legacy', '1');
    const v1 = $<HTMLAnchorElement>('v1link');
    v1.href = '../3d.html?' + legacy + location.hash;
    v1.addEventListener('click', () => {
      try { localStorage.setItem('kosno-3d', 'v1'); } catch { /* storage blocked: ?legacy=1 still works */ }
      track('gallery_version_switch', { to: 'v1', place: 'gallery' });
    });
  }

  /* ============================== world + GPU ============================== */
  await document.fonts?.ready;
  const world = buildWorld(lang, T);

  const imgs: number[] = [];
  const instances: InstanceRec[] = [];
  const instImg: number[] = [];
  const refs: PaintingInstanceRef[] = [];
  const addImg = (img: number) => { if (!imgs.includes(img)) imgs.push(img); };
  // the lobby portrait first, then the rooms in visiting order (v1 queue order)
  for (const p of [...placements].sort((a, b) => (a.room === 0 ? -1 : 0) - (b.room === 0 ? -1 : 0))) p.item.imgs.forEach(addImg);
  const tex = createPaintingTextures(root, imgs, { hiSize: tier === 'high' ? 1280 : 1024, slots: tier === 'high' ? 14 : 8 });
  for (const p of placements) {
    const N = normalOf(p), R = rightOf(p);
    const panels = p.item.imgs.length;
    const panelW = panels > 1 ? (p.w - 0.06) / 2 : p.w;
    const tierA = p.item.tier === 'A+' || p.item.tier === 'A';
    const frameHex = tierA ? [0x4a, 0x3a, 0x28] : [0x2c, 0x20, 0x16];
    p.item.imgs.forEach((img, k) => {
      const off = panels > 1 ? (k === 0 ? -(panelW / 2 + 0.03) : (panelW / 2 + 0.03)) : 0;
      instances.push({
        center: [p.cx + R[0] * off, p.cy, p.cz + R[2] * off], right: [R[0], R[1], R[2]], normal: [N[0], N[1], N[2]],
        hw: panelW / 2, hh: p.h / 2, room: p.room, frameCol: frameHex.map(c => c / 255) as [number, number, number],
        img, layer: tex.layerOf.get(img) ?? 0,
      });
      instImg.push(img);
      refs.push({ img, x: p.cx, z: p.cz });
    });
  }
  // the portal back from the forest: painting № 052 itself, hung in the air (appended after the museum)
  const museumInstances = instances.length;
  {
    const it52 = findItem(52);
    if (it52) {
      instances.push({ center: [PORTAL[0], PORTAL[1], PORTAL[2]], right: [-1, 0, 0], normal: [0, 0, -1], hw: 0.6, hh: 0.79,
        room: world.forestRoom, frameCol: [0x4a / 255, 0x3a / 255, 0x28 / 255], img: 52, layer: tex.layerOf.get(52) ?? 0 });
      instImg.push(52);
      refs.push({ img: 52, x: PORTAL[0], z: PORTAL[2] });
    }
  }
  const renderer = createRenderer(root, $<HTMLCanvasElement>('scene'), world, { tier, tex, instances, museumInstances, profile: q.get('perf') === '1' });
  const pool = new HiResPool(tex, tier === 'high' ? 14 : 8, tier === 'high' ? 12 : 6);
  const thumbReady = new Set<number>();
  let dynDirty = true;
  tex.loadThumbs(imgs, (img, done, total) => {
    thumbReady.add(img); dynDirty = true;
    const pct = Math.round(100 * done / total);
    ($('loadbar').firstElementChild as HTMLElement).style.width = pct + '%';
    $('loadpct').textContent = pct >= 100 ? T('ready') : `${T('loading')} ${pct}%`;
  });
  setInterval(() => pool.update(refs, S.pos[0], S.pos[2]), 700);
  let warm = false;
  renderer.warmup().catch(err => console.warn('warmup', err)).finally(() => { warm = true; });

  let forest: Forest | null = null;
  const getForest = () => (forest ??= createForest(root, renderer, tier === 'high'));

  /* ============================== HUD (v1) ============================== */
  const intro = $('intro');
  const introHidden = () => intro.classList.contains('hidden');
  const hint = $('hint');
  let hintTimer = setTimeout(() => hint.classList.add('hidden'), 14000);
  function flashHint(msg: string) {
    hint.textContent = msg; hint.classList.remove('hidden');
    clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.add('hidden'), 3200);
  }
  const roomsel = $<HTMLSelectElement>('roomsel');
  rooms.forEach((r, i) => {
    if (r.secret) return;
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = r.lobby ? T('entrance') : `${T('room')} ${ROMAN[i - 1]} — ${tGroup(lang, r.name)}`;
    roomsel.appendChild(o);
  });
  roomsel.addEventListener('change', () => { teleport(+roomsel.value); roomsel.blur(); });
  const roomtag = $('roomtag');

  function teleport(i: number) {
    if (S.inForest) exitForest(false);
    if (teleportTo(i) && i > 0) flashHint(`${T('room')} ${ROMAN[i - 1]} — ${tGroup(lang, rooms[i].name)}`);
  }

  /* ============================== card (v1) ============================== */
  const card = $('card');
  const cardEls = {
    num: card.querySelector('.num') as HTMLElement, sold: card.querySelector('.soldb') as HTMLElement,
    title: card.querySelector('h3') as HTMLElement, sub: card.querySelector('.sub') as HTMLElement,
    price: card.querySelector('.price') as HTMLElement, note: card.querySelector('.note') as HTMLElement,
    soldinfo: card.querySelector('.soldinfo') as HTMLElement,
  };
  let cardItem: Item | null = null;
  function fillCard(it: Item) {
    cardEls.num.textContent = `№ ${String(it.n).padStart(3, '0')} · ${tCat(lang, it.cat)}`;
    cardEls.sold.hidden = !it.sold;
    cardEls.sold.textContent = T('soldBadge');
    cardEls.title.textContent = tTitle(lang, it);
    const dims = it.measured ? `${it.w} × ${it.h} cm` : `${T('approx')} ${Math.round(it.w)} × ${Math.round(it.h)} cm`;
    cardEls.sub.textContent = [it.year, dims, it.support ? tSup(lang, it.support) : ''].filter(Boolean).join(' · ');
    cardEls.price.hidden = !it.sold;
    if (it.sold) cardEls.price.innerHTML = `${T('sold')}: <b>${it.soldInfo || ''}</b>`;
    cardEls.note.hidden = true; cardEls.soldinfo.hidden = true;
  }
  const aspect = () => { const c = $<HTMLCanvasElement>('scene'); return (c.clientWidth || innerWidth) / (c.clientHeight || innerHeight); };
  function project(x: number, y: number, z: number): [number, number] | null {
    const { yaw, pitch } = S, cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp], r = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const v = [x - S.pos[0], y - S.pos[1], z - S.pos[2]];
    const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    if (zc < 0.05) return null;
    const th = Math.tan(FOV / 2);
    const nx = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (zc * th * aspect()), ny = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (zc * th);
    return [(nx * 0.5 + 0.5) * innerWidth, (-ny * 0.5 + 0.5) * innerHeight];
  }
  function showCardFor(it: Item) {
    if (cardItem !== it) { fillCard(it); cardItem = it; }
    if (isTouch) { card.classList.add('sheet', 'show'); return; }
    const p = placements.find(pl => pl.item === it && pl.pickable)!;
    const sp = project(p.cx, p.cy + p.h / 2 + 0.12, p.cz) ?? [innerWidth / 2, innerHeight / 2];
    const W = card.offsetWidth || 320, H = card.offsetHeight || 170;
    const sx = Math.max(14, Math.min(innerWidth - W - 14, sp[0] - W / 2));
    const sy = Math.max(14, Math.min(innerHeight - H - 14, sp[1] - H - 10));
    card.style.left = sx + 'px'; card.style.top = sy + 'px';
    card.classList.add('show');
  }
  function hideCard() { card.classList.remove('show'); cardItem = null; }
  const focusOff = (silent = false) => { endFocus(); if (!silent) hideCard(); };

  /* ============================== the forest gate ============================== */
  function enterForest() {
    track('forest_entered', {});
    S.forestReturn = { pos: [...S.pos], yaw: S.yaw, pitch: S.pitch };
    focusOff(true); hideCard();
    getForest().enter();
    flashHint(T('forestName'));
  }
  function exitForest(restore = true) {
    if (!S.inForest) return;
    getForest().exit();
    if (restore && S.forestReturn) { S.pos = [...S.forestReturn.pos]; S.yaw = S.forestReturn.yaw; S.pitch = S.forestReturn.pitch; }
  }
  function tryEnter52() {
    if (S.hasOrangeKey) enterForest();
    else { track('forest_locked_attempt', {}); flashHint(T('locked52')); }
  }

  /* ============================== input (v1) ============================== */
  const canvas = $<HTMLCanvasElement>('scene');
  const jump = () => doJump(introHidden());
  $('jumpbtn').addEventListener('touchstart', jump, { passive: true });
  $('jumpbtn').addEventListener('click', jump);

  addEventListener('keydown', e => {
    S.keys[e.code] = true;
    if (e.code.startsWith('Digit')) { const i = +e.code.slice(5); if (i >= 1 && i <= 9) teleport(i); }
    if (e.code === 'Space') jump();
    if (e.code === 'KeyN' && introHidden() && !S.inForest) {
      const pubs = placements.filter(p => p.pickable && (!p.secret || S.secretOpen));
      let idx = 0;
      if (S.focusItem) {
        const cur = pubs.findIndex(p => p.item === S.focusItem);
        idx = (cur + (e.shiftKey ? -1 : 1) + pubs.length) % pubs.length;
      } else {
        let bd = 1e9;
        pubs.forEach((p, i) => { const dd = Math.hypot(p.cx - S.pos[0], p.cz - S.pos[2]); if (dd < bd) { bd = dd; idx = i; } });
      }
      startFocus(pubs[idx].item, 'key_n');
    }
    if (S.focusItem && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) focusOff();
    if (e.code === 'Escape' && S.focusItem) focusOff();
  });
  addEventListener('keyup', e => { S.keys[e.code] = false; });

  intro.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('a, .opts')) return;
    if (!S.entered) { S.entered = true; track('gallery_enter', { device: isTouch ? 'touch' : 'desktop', lang }); }
    intro.classList.add('hidden');
    if (!isTouch) canvas.requestPointerLock();
  });
  canvas.addEventListener('click', () => { if (!isTouch && !S.locked) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {
    S.locked = document.pointerLockElement === canvas;
    document.body.classList.toggle('locked', S.locked);
  });
  addEventListener('mousemove', e => {
    if (!S.locked || S.focusAnim) return;
    S.yaw -= e.movementX * 0.0023;
    S.pitch -= e.movementY * 0.0023 * (S.invY ? -1 : 1);
    S.pitch = Math.max(-1.35, Math.min(1.35, S.pitch));
  });
  canvas.addEventListener('mousedown', () => {
    if (isTouch || !S.locked) return;
    const hit = pick(0, 0, aspect(), 12);
    if (hit) {
      if (S.focusItem === hit.p.item) {
        if (S.focusItem.n === 52) { tryEnter52(); if (!S.inForest) focusOff(); }
        else focusOff();
      } else startFocus(hit.p.item);
    } else if (S.inForest) {
      if (getForest().click(aspect())) exitForest();
    } else if (S.focusItem) focusOff();
  });

  /* touch: left half = joystick, right half = look, short tap = pick */
  const stick = $('stick');
  let moveTouch: { id: number; x: number; y: number } | null = null;
  let lookTouch: { id: number; x: number; y: number } | null = null;
  let tapInfo: { x: number; y: number; t: number } | null = null;
  addEventListener('touchstart', e => {
    if (!introHidden()) return;
    if ((e.target as HTMLElement).closest('select,a,button,#roomnav,#card')) return;
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && moveTouch === null) {
        moveTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        stick.style.display = 'block';
        stick.style.left = (t.clientX - 55) + 'px'; stick.style.top = (t.clientY - 55) + 'px';
      } else if (lookTouch === null) {
        lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        tapInfo = { x: t.clientX, y: t.clientY, t: Date.now() };
      }
    }
  }, { passive: true });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (moveTouch && t.identifier === moveTouch.id) {
        let dx = (t.clientX - moveTouch.x) / 45, dy = (t.clientY - moveTouch.y) / 45;
        const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        S.moveVec = { x: dx, y: dy };
        (stick.firstElementChild as HTMLElement).style.transform = `translate(${dx * 30}px,${dy * 30}px)`;
      } else if (lookTouch && t.identifier === lookTouch.id) {
        S.yaw -= (t.clientX - lookTouch.x) * 0.005;
        S.pitch -= (t.clientY - lookTouch.y) * 0.005;
        S.pitch = Math.max(-1.35, Math.min(1.35, S.pitch));
        lookTouch.x = t.clientX; lookTouch.y = t.clientY;
        if (tapInfo && Math.hypot(t.clientX - tapInfo.x, t.clientY - tapInfo.y) > 12) tapInfo = null;
      }
    }
  }, { passive: true });
  addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (moveTouch && t.identifier === moveTouch.id) { moveTouch = null; S.moveVec = { x: 0, y: 0 }; stick.style.display = 'none'; }
      if (lookTouch && t.identifier === lookTouch.id) {
        if (tapInfo && Date.now() - tapInfo.t < 350) handleTap(tapInfo.x, tapInfo.y);
        lookTouch = null; tapInfo = null;
      }
    }
  });
  function handleTap(x: number, y: number) {
    const hit = pick(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1, aspect());
    if (hit) {
      const itm = hit.p.item;
      if (S.focusItem === itm && itm.n === 52) tryEnter52();
      else startFocus(itm, 'tap');
    } else if (S.inForest) { if (getForest().click(aspect(), x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1)) exitForest(); }
    else if (S.focusItem) focusOff();
  }

  /* ============================== deep links (v1) ============================== */
  {
    const s = +(q.get('sala') || 0);
    if (s >= 1 && s <= 9) teleport(s);
    const ob = +(q.get('obraz') || 0);
    const pl = placements.find(p => p.item.n === ob && !p.secret && p.pickable);
    if (pl) {
      const [nX, , nZ] = normalOf(pl);
      S.pos = [pl.cx + nX * 2.6, EYE, pl.cz + nZ * 2.6];
      startFocus(pl.item, 'deeplink');
    }
  }

  /* ============================== animated groups (plug + keys) ============================== */
  const groups = new Float32Array(64);
  const M = mat4.create();
  const keySpin = { blue: 0, orange: 0 };
  function writeGroups() {
    mat4.identity(M); groups.set(M, 0);
    const e2 = S.plugT === null ? (S.plugDone ? 1 : 0) : S.plugT * S.plugT;
    mat4.translation([0, S.plugDone ? -40 : -(DOOR_H + 0.06) * e2, 0], M); groups.set(M, 16);
    const keyM = (k: typeof KEY_BLUE, spin: number, hidden: boolean, off: number) => {
      mat4.translation([k.x, hidden ? -60 : k.y, k.z], M);
      mat4.rotateX(M, -Math.PI / 2, M);
      mat4.rotateZ(M, k.rz + spin, M);
      groups.set(M, off);
    };
    keyM(KEY_BLUE, keySpin.blue, S.hasKey, 32);
    keyM(KEY_ORANGE, keySpin.orange, S.hasOrangeKey, 48);
  }

  /* ============================== perf overlay (?perf=1) ============================== */
  const perfEl = $('perf');
  const showPerf = q.get('perf') === '1';
  if (showPerf) perfEl.hidden = false;
  let frames = 0, perfT = performance.now();

  /* ============================== main loop ============================== */
  let last = performance.now();
  let lastRoomIdx = -1;
  let winSum = 0, winN = 0, calm = 0;
  const refreshSamples: number[] = [];
  let refreshCache = 0;
  /* the display's frame interval, from rAF deltas measured while the intro is up (fallback 60 Hz) */
  const refresh = () => {
    if (refreshCache) return refreshCache;
    if (refreshSamples.length < 20) return 1 / 60;
    const sorted = [...refreshSamples].sort((a, b) => a - b);
    const r = Math.min(1 / 30, Math.max(1 / 240, sorted[Math.floor(sorted.length * 0.3)]));
    if (refreshSamples.length >= 90) refreshCache = r;
    return r;
  };
  const pickAspect = () => aspect();

  function frame(now: number) {
    requestAnimationFrame(frame);
    tick(now);
  }
  function tick(now: number) {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    S.time += dt;
    step(dt);

    /* hover pick → card */
    if (introHidden()) {
      if (S.focusItem) showCardFor(S.focusItem);
      else {
        const hit = S.inForest ? null : pick(0, 0, pickAspect(), 7);
        if (hit) showCardFor(hit.p.item); else hideCard();
      }
    }

    /* blue key: spin, pick up when near */
    if (!S.hasKey) {
      keySpin.blue += dt * 0.8;
      if (!S.inForest && Math.hypot(S.pos[0] - KEY_BLUE.x, S.pos[2] - KEY_BLUE.z) < 0.85) {
        S.hasKey = true; $('keyicon').style.display = 'block';
        flashHint(T('keyFound')); track('key_found', { key: 'blue' });
      }
    }
    if (S.secretOpen && !S.hasOrangeKey) {
      keySpin.orange += dt * 0.8;
      if (!S.inForest && Math.hypot(S.pos[0] - KEY_ORANGE.x, S.pos[2] - KEY_ORANGE.z) < 0.85) {
        S.hasOrangeKey = true; $('okeyicon').style.display = 'block';
        flashHint(T('okeyFound')); track('key_found', { key: 'orange' });
      }
    }
    /* jump by the end wall with the key → the plug slides into the floor */
    if (S.hasKey && !S.secretOpen && S.jumpY > 0.04 && S.pos[0] > END_X - 2.3 && S.pos[0] < END_X && Math.abs(S.pos[2]) < 2.4) {
      S.secretOpen = true; S.plugT = 0;
      flashHint(T('secretOpen')); track('secret_opened', {});
      const pi = walls.indexOf(plugWall); if (pi >= 0) walls.splice(pi, 1);
    }
    if (S.plugT !== null) {
      S.plugT = Math.min(1, S.plugT + dt / 1.8);
      if (S.plugT >= 1) { S.plugT = null; S.plugDone = true; }
    }

    /* forest life + the way back */
    if (S.inForest && forest) {
      forest.update(dt, aspect());
      if (forest.atPortal()) exitForest();
    }

    /* room tag + analytics */
    if (S.inForest) {
      if (lastRoomIdx !== -2) { lastRoomIdx = -2; roomtag.textContent = T('forestName'); }
    } else {
      const ri = roomAt(S.pos[0]);
      if (ri !== lastRoomIdx) {
        lastRoomIdx = ri;
        if (ri === SECRET_ROOM) { roomtag.textContent = T('secretRoom'); track('room_enter', { room: 'secret_room' }); }
        else {
          roomtag.textContent = rooms[ri].lobby ? '' : `${T('room')} ${ROMAN[ri - 1]} · ${tGroup(lang, rooms[ri].name)}`;
          roomsel.value = String(ri);
          track('room_enter', { room: rooms[ri].lobby ? 'lobby' : rooms[ri].name });
        }
      }
    }

    /* streaming → GPU */
    if (pool.tick(dt)) dynDirty = true;
    if (dynDirty) {
      instImg.forEach((img, i) => renderer.setDyn(i, pool.slotOf(img), pool.slotOf(img) >= 0 ? (pool.fade.get(img) ?? 0) : 0, thumbReady.has(img) ? 1 : 0));
      renderer.flushDyn();
      dynDirty = false;
    }

    // nothing to draw while the (opaque) intro covers the canvas — just learn the display's refresh rate
    if (dt > 0 && refreshSamples.length < 90) refreshSamples.push(dt);
    if (!introHidden()) return;
    if (!warm) return;
    writeGroups();
    const fogM = S.inForest && forest ? forest.fog : { color: [0.56, 0.52, 0.45] as [number, number, number], near: 36, far: 135 };
    renderer.render({
      pos: S.pos, yaw: S.yaw, pitch: S.pitch, time: S.time, groups,
      fog: fogM, ambient: S.inForest && forest ? forest.ambient : [0.3, 0.29, 0.27],
      exposure: S.inForest ? 0.92 : 0.82, inForest: S.inForest, sun: S.inForest && forest ? forest.sun : undefined,
    });

    /* dynamic resolution: hold the display's refresh rate (60/120 Hz…) by stepping the internal
       resolution — down quickly when frames run long, back up slowly when there is headroom */
    if (q.get('scale') === null && dt > 0) {
      winSum += dt; winN++;
      if (winN >= 40) {
        const avg = winSum / winN;
        winSum = 0; winN = 0;
        const s = renderer.renderScale;
        if (avg > refresh() * 1.22 && s > 0.62) { renderer.renderScale = Math.max(0.6, s - 0.08); calm = 0; }
        else if (avg < refresh() * 1.06) { if (++calm >= 4 && s < 1) { renderer.renderScale = Math.min(1, s + 0.05); calm = 0; } }
        else calm = 0;
      }
    }

    if (showPerf) {
      frames++;
      if (now - perfT > 500) {
        const fps = frames * 1000 / (now - perfT); frames = 0; perfT = now;
        const [w, h] = renderer.size;
        perfEl.textContent = `WebGPU · TypeGPU\n${fps.toFixed(0)} fps · ${(1000 / fps).toFixed(1)} ms (display ${(1 / refresh()).toFixed(0)} Hz)\nGPU ≈ ${renderer.gpuMs.toFixed(1)} ms / frame\n${w}×${h} (render scale ${renderer.effectiveScale.toFixed(2)})`;
      }
    }
  }
  if (q.get('scale')) renderer.renderScale = Math.max(0.3, Math.min(1, +q.get('scale')!));
  requestAnimationFrame(frame);

  /* ============================== debug / automation hooks (same API as v1) ============================== */
  (window as unknown as { __gallery: unknown }).__gallery = {
    rooms, placements, renderer, world, version: 'v2',
    get yaw() { return S.yaw; }, get moveVec() { return S.moveVec; }, get focusItem() { return S.focusItem; },
    get state() { return { hasKey: S.hasKey, hasOrangeKey: S.hasOrangeKey, secretOpen: S.secretOpen, inForest: S.inForest, jumpY: S.jumpY, lang }; },
    get touchState() { return { moveTouch: !!moveTouch, lookTouch: !!lookTouch, tapInfo: !!tapInfo }; },
    get ladies() { return forest?.ladiesState() ?? []; },
    get forestDbg() { return forest?.dbg; },
    get camera() { return { position: { x: S.pos[0], y: S.pos[1], z: S.pos[2] } }; },
    tap(x?: number, y?: number) {
      const hit = pick((x ?? innerWidth / 2) / innerWidth * 2 - 1, -((y ?? innerHeight / 2) / innerHeight) * 2 + 1, aspect());
      return hit ? { d: +hit.distance.toFixed(2), n: hit.p.item.n } : null;
    },
    look(y: number, p?: number) { S.yaw = y; S.pitch = p ?? 0; },
    goto(x: number, z: number, y?: number, p?: number) { S.pos = [x, EYE, z]; if (y !== undefined) S.yaw = y; if (p !== undefined) S.pitch = p; },
    focus(n: number) { const it = findItem(n); if (it) startFocus(it); },
    jump() { if (S.jumpY === 0 && S.vy === 0) S.vy = 4.6; },
    giveKey() { S.hasKey = true; $('keyicon').style.display = 'block'; },
    giveOrangeKey() { S.hasOrangeKey = true; $('okeyicon').style.display = 'block'; },
    forest() { enterForest(); },
    leaveForest() { exitForest(); },
    shader() { return renderer.shaderCode(); },
    /* GPU wall time per frame: submit → queue idle, median of n (profiling) */
    async gpuFrameMs(n = 12) {
      const ts: number[] = [];
      for (let k = 0; k < n; k++) {
        await root.device.queue.onSubmittedWorkDone();
        const t0 = performance.now(); tick(last + 16.7); await root.device.queue.onSubmittedWorkDone(); ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b); return +ts[Math.floor(n / 2)].toFixed(2);
    },
    /* drive frames manually (automation in hidden tabs, where rAF does not fire) */
    tick(n = 1, ms = 16.7) { for (let k = 0; k < n; k++) tick(last + ms); },
    items: KOSNO.items.length,
  };
}
