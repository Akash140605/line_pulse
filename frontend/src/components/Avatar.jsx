import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Upload, Trash2 } from 'lucide-react';
import { api } from '../api';
import { squareImage } from '../utils/fileData';
import { useFileUrl } from './Evidence';

/**
 * 20-11-2026: the picture of a login — a photo (cropped square, 256 px) or one of the fun pictures (😎 🤖 🦁 …);
 * the initials when none is chosen. Kept by files.php (store user_avatars), one per login, every screen shows it.
 */
export const AVATAR_PRESETS = ['😎', '🤖', '🦁', '🐯', '🐼', '🦊', '🐵', '🦉', '👷', '🧑‍🔧', '🥷', '🦸', '🧙', '👽', '🐱', '🐶', '🚀', '⚡', '🔥', '🏆', '🤓', '🥳', '😴', '🤠'];
const BG = ['#FDE68A', '#BFDBFE', '#C7D2FE', '#FBCFE8', '#BBF7D0', '#FED7AA', '#DDD6FE', '#A5F3FC'];

// one list for every avatar on the screen; a change by this login is sent to all of them
let store = { map: null, p: null };
const subs = new Set();
const tell = () => subs.forEach((f) => f(store.map));
function load(force = false) {
  if (!store.p || force) store.p = api.avatars().then((j) => { store.map = j.avatars || {}; tell(); return store.map; }).catch(() => { store.p = null; return store.map || {}; });
  return store.p;
}
export function useAvatars(on = true) {
  const [m, setM] = useState(store.map);
  useEffect(() => { if (!on) return undefined; subs.add(setM); load(); return () => { subs.delete(setM); }; }, [on]);
  return m || {};
}

export function initialsOf(name) {
  return String(name || '').trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'U';
}
const bgOf = (s) => BG[[...String(s || '')].reduce((a, c) => a + c.codePointAt(0), 0) % BG.length];

/** one round picture: av = { preset } | { file } | undefined */
export function AvatarPic({ av, name, size = 30, className = '' }) {
  const { url } = useFileUrl(av?.file || null);
  const st = { width: size, height: size };
  if (av?.file && url) return <img src={url} alt="" style={st} className={`shrink-0 rounded-full object-cover ${className}`} />;
  if (av?.preset) return <span style={{ ...st, background: bgOf(av.preset), fontSize: Math.round(size * 0.58) }} className={`grid shrink-0 place-items-center rounded-full leading-none ${className}`} aria-hidden>{av.preset}</span>;
  return <span style={{ ...st, fontSize: Math.round(size * 0.4) }} className={`grid shrink-0 place-items-center rounded-full bg-white font-extrabold text-[#1F3864] ${className}`} aria-hidden>{initialsOf(name)}</span>;
}

/** the login's own picture: choose a fun picture, upload / take a photo, or go back to the initials */
export function ProfileDialog({ me, onClose }) {
  const all = useAvatars();
  const mine = all[me.user];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null); const camRef = useRef(null);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const send = async (body, done) => {
    setBusy(true); setMsg('');
    try { const j = await api.setAvatar(body); store.map = j.avatars || {}; store.p = Promise.resolve(store.map); tell(); setMsg(done); }
    catch (x) { setMsg(`Could not save: ${x.message}`); }
    setBusy(false);
  };
  const photo = async (files) => {
    const f = files?.[0]; if (!f) return;
    if (!/^image\//.test(f.type)) { setMsg('Choose a photo (JPG, PNG or WEBP).'); return; }
    try { const data = await squareImage(f, 256); await send({ data }, 'Photo saved.'); } catch (x) { setMsg(x.message); }
  };
  const name = me.display || me.user;
  const btn = 'inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-14 font-bold text-slate-800 hover:border-blue-500 disabled:opacity-50';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="My picture" onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-fs-18 font-bold text-dixon-ink">My picture</div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 hover:bg-slate-200"><X size={20} /></button>
        </div>
        <div className="grid gap-4 p-4">
          <div className="flex items-center gap-3">
            <AvatarPic av={mine} name={name} size={72} className="ring-2 ring-slate-200" />
            <div className="min-w-0"><div className="truncate text-fs-16 font-extrabold text-slate-900">{name}</div><div className="text-fs-13 text-slate-500">Shown at the top of every screen.</div></div>
          </div>
          <div>
            <div className="mb-1.5 text-fs-13 font-bold text-slate-700">Select a picture</div>
            <div className="grid grid-cols-6 gap-2" role="list" aria-label="Fun pictures">
              {AVATAR_PRESETS.map((p) => (
                <button key={p} type="button" role="listitem" disabled={busy} onClick={() => send({ preset: p }, 'Picture saved.')} aria-label={`Picture ${p}`} aria-pressed={mine?.preset === p}
                  className={`grid aspect-square place-items-center rounded-xl text-[26px] transition hover:scale-110 ${mine?.preset === p ? 'ring-[3px] ring-blue-600' : 'ring-1 ring-slate-200'}`} style={{ background: bgOf(p) }}>{p}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={15} aria-hidden /> Upload my photo</button>
            <button type="button" className={btn} disabled={busy} onClick={() => camRef.current?.click()}><Camera size={15} aria-hidden /> Take a selfie</button>
            {mine && <button type="button" className={`${btn} text-red-700`} disabled={busy} onClick={() => send({ clear: true }, 'Back to the initials.')}><Trash2 size={15} aria-hidden /> Remove</button>}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="My photo" onChange={(e) => { photo(e.target.files); e.target.value = ''; }} />
            <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" aria-label="Take a selfie" onChange={(e) => { photo(e.target.files); e.target.value = ''; }} />
          </div>
          {(busy || msg) && <div role="status" className={`text-fs-13 font-semibold ${msg.startsWith('Not') ? 'text-red-700' : 'text-blue-800'}`}>{busy ? 'Saving…' : msg}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
