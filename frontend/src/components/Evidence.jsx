import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Camera, FileText, X, Download } from 'lucide-react';
import { api } from '../api';
import { isImage, readBase64, shrinkImage, fmtSize } from '../utils/fileData';

/**
 * 20-11-2026: evidence of an RCA — photos (taken with the phone camera or chosen) and files (PDF, Excel, Word …).
 * Each file is uploaded at once (files.php) and listed on the RCA by its id; the RCA keeps them when it is saved.
 */
export const EVIDENCE_MAX = 10;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.pdf,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.csv,.txt';
const OK_EXT = /\.(jpe?g|png|webp|gif|pdf|xlsx|xls|docx|doc|pptx|ppt|csv|txt)$/i;

/** blob: URL of a kept file (null while it comes) */
export function useFileUrl(id) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true; setUrl(null); setErr(false);
    if (id) api.fileUrl(id).then((u) => { if (live) setUrl(u); }, () => { if (live) setErr(true); });
    return () => { live = false; };
  }, [id]);
  return { url, err };
}

function Thumb({ f, onOpen, onRemove }) {
  const img = isImage(f.type, f.name);
  const { url, err } = useFileUrl(f.id);
  return (
    <li className="group relative w-[104px]" aria-label={`Evidence ${f.name}`}>
      <button type="button" onClick={() => url && onOpen(f, url)} title={f.name} aria-label={`Open ${f.name}`} disabled={!url}
        className="grid h-[84px] w-[104px] place-items-center overflow-hidden rounded-lg border border-slate-300 bg-slate-50 hover:border-blue-500">
        {img && url ? <img src={url} alt={f.name} className="h-full w-full object-cover" />
          : <span className="grid place-items-center gap-1 text-slate-600"><FileText size={26} aria-hidden /><span className="text-fs-11 font-bold uppercase">{(f.name.split('.').pop() || '').slice(0, 5)}</span></span>}
        {!url && !err && <span className="absolute inset-0 grid place-items-center bg-white/60 text-fs-11 text-slate-500">…</span>}
        {err && <span className="absolute inset-0 grid place-items-center bg-white/80 text-fs-11 font-bold text-red-700">not found</span>}
      </button>
      <div className="mt-0.5 truncate text-fs-11 text-slate-600" title={f.name}>{f.name}</div>
      {f.size > 0 && <div className="text-fs-10 text-slate-400">{fmtSize(f.size)}</div>}
      {onRemove && <button type="button" onClick={() => onRemove(f)} aria-label={`Remove ${f.name}`}
        className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-white shadow hover:bg-red-700"><X size={13} aria-hidden /></button>}
    </li>
  );
}

/** a photo large on the screen; any other file is downloaded */
function Viewer({ f, url, onClose }) {
  // Escape closes only the photo, not the RCA under it (caught first, not passed on)
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onClose]);
  return (
    <div role="dialog" aria-label={`Evidence ${f.name}`} className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        {f.type === 'application/pdf'
          ? <iframe title={f.name} src={url} className="h-[85vh] w-[min(900px,92vw)] rounded-lg bg-white" />
          : <img src={url} alt={f.name} className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain" />}
        <div className="mt-2 flex items-center justify-between gap-3 text-fs-13 text-white">
          <span className="truncate">{f.name}</span>
          <span className="flex gap-2">
            <a href={url} download={f.name} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 font-bold text-slate-900"><Download size={15} aria-hidden /> Download</a>
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-white/60 px-3 font-bold">Close</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * list = [{ id, name, type, size }]; onChange(list) when files are added / removed (canEdit), shows them read-only otherwise.
 */
export default function Evidence({ list = [], onChange, canEdit = false }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [view, setView] = useState(null);
  const fileRef = useRef(null); const camRef = useRef(null);
  const listRef = useRef(list); listRef.current = list;
  const add = async (files) => {
    setErr('');
    const room = EVIDENCE_MAX - listRef.current.length;
    const pick = [...files].slice(0, Math.max(0, room));
    if (files.length > pick.length) setErr(`At most ${EVIDENCE_MAX} files on one RCA.`);
    for (const file of pick) {
      if (!OK_EXT.test(file.name) && !isImage(file.type)) { setErr(`${file.name}: only photos, PDF, Excel, Word, PowerPoint, CSV or text files.`); continue; }
      setBusy(`Adding ${file.name} …`);
      try {
        const img = isImage(file.type, file.name);
        if (!img && file.size > 5_000_000) throw new Error('the file is larger than 5 MB');
        const { name, data } = img ? await shrinkImage(file) : { name: file.name, data: await readBase64(file) };
        const j = await api.uploadFile(/\.[a-z0-9]+$/i.test(name) ? name : `${name}.jpg`, data);
        listRef.current = [...listRef.current, j.file];
        onChange(listRef.current);
      } catch (e) { setErr(`${file.name}: ${e.message}`); }
    }
    setBusy('');
  };
  const pickBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-fs-13 font-bold text-slate-800 hover:border-blue-500 disabled:opacity-50';
  return (
    <fieldset className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5" aria-label="Evidence">
      <legend className="px-1 text-fs-13 font-extrabold text-slate-800">Evidence <span className="font-normal normal-case text-slate-500">(photo or file{canEdit ? `, up to ${EVIDENCE_MAX}` : ''})</span></legend>
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {list.map((f) => <Thumb key={f.id} f={f} onOpen={(x, url) => (isImage(x.type, x.name) || x.type === 'application/pdf' ? setView({ f: x, url }) : Object.assign(document.createElement('a'), { href: url, download: x.name }).click())}
            onRemove={canEdit ? (x) => onChange(list.filter((y) => y.id !== x.id)) : null} />)}
        </ul>
      ) : <div className="text-fs-13 text-slate-500">{canEdit ? 'No photo or file yet — add the photo of the defect, the 5-Why sheet, a test report …' : 'No evidence added.'}</div>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={pickBtn} disabled={!!busy || list.length >= EVIDENCE_MAX} onClick={() => camRef.current?.click()}><Camera size={15} aria-hidden /> Take photo</button>
          <button type="button" className={pickBtn} disabled={!!busy || list.length >= EVIDENCE_MAX} onClick={() => fileRef.current?.click()}><Paperclip size={15} aria-hidden /> Add photo / file</button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take a photo" onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" aria-label="Evidence files" onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
          {busy && <span className="text-fs-13 font-semibold text-blue-800" role="status">{busy}</span>}
        </div>
      )}
      {err && <div role="alert" className="rounded-md bg-red-50 px-2 py-1 text-fs-13 font-semibold text-red-800">{err}</div>}
      {view && <Viewer f={view.f} url={view.url} onClose={() => setView(null)} />}
    </fieldset>
  );
}
