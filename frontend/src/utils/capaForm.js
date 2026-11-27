/**
 * 24-11-2026: the plant's paper "CORRECTIVE AND PREVENTIVE ACTION PLAN" (CAPA) for an RCA, and its PDF.
 *   capaHead()   the form header (doc no, revision …) — mirrors capa_head in backend/lib/capa.php
 *   capaRows()   the rows of the form, worked out from an RCA record (pure, tested)
 *   capaPdf()    draws the form (and the evidence photos) on A4 landscape pages and returns a PDF file (Blob)
 * The PDF is made in the browser: every page is drawn on a canvas and kept as a JPEG page (no extra library).
 */

const txt = (v, max, def = '') => { const s = String(v ?? '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max); return s || def; };
export function capaHead(h = {}) {
  return {
    company: txt(h?.company, 80, 'DIXON TECHNOLOGIES INDIA LIMITED'),
    title: txt(h?.title, 80, 'CORRECTIVE AND PREVENTIVE ACTION PLAN'),
    docNo: txt(h?.docNo, 40, 'DIXON/MAINT/05/20'),
    revNo: txt(h?.revNo, 10, '0'),
    revDate: txt(h?.revDate, 20, '01-01-2020'),
    hall: txt(h?.hall, 40, ''),
  };
}
export const EMPTY_CAPA = { equip: '', hall: '', problem: '', correction: '', whyQ: ['', '', '', '', ''], caTarget: '', caResp: '', paTarget: '', paResp: '', implemented: '', verifiedBy: '', verifyDate: '', verifyNote: '' };
export const IMPL_TEXT = { yes: 'Yes — implemented', partly: 'Partly implemented', no: 'Not implemented', '': '' };
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : String(d || ''));
const KIND = { stop: 'Planned stoppage', loss: 'Unplanned loss', reject: 'Rejection', rework: 'Rework' };

/** the filled form of an RCA record (r = ole_rca item) */
export function capaRows(r = {}, head = {}) {
  const c = { ...EMPTY_CAPA, ...(r.capa || {}) };
  const H = capaHead(head);
  // 27-11-2026: as many whys as written (3 at least, 7 at most)
  const nW = Math.min(7, Math.max(3, (c.whyQ || []).length, (r.whys || []).length));
  const whys = Array.from({ length: nW }, (_, k) => ({ q: c.whyQ?.[k] || (k === 0 && r.whys?.[0] ? `Why did ${r.reason || 'it'} happen?` : k > 0 && r.whys?.[k - 1] ? `Why ${String(r.whys[k - 1]).replace(/[.?!]+$/, '')}?` : ''), a: r.whys?.[k] || '' }));
  return {
    head: H,
    equip: c.equip || '',
    date: dmy(r.date),
    hall: c.hall || H.hall || '',
    problem: c.problem || `${KIND[r.kind] || 'Loss'}: ${r.reason || ''} — Line ${r.line ?? ''}, ${dmy(r.date)}`.trim(),
    correction: c.correction || '',
    whys,
    rootCause: r.rootCause || '',
    corrective: { text: r.action || '', target: dmy(c.caTarget || r.targetDate), resp: c.caResp || r.owner || '' },
    preventive: { text: r.preventive || '', target: dmy(c.paTarget), resp: c.paResp || '' },
    verify: { implemented: IMPL_TEXT[c.implemented] || (r.status === 'closed' ? 'Yes — closed' : ''), sign: [c.verifiedBy || r.closedBy || '', dmy(c.verifyDate || r.closeDate)].filter(Boolean).join(' · '), note: c.verifyNote || '' },
    foot: [`Line ${r.line ?? ''}`, KIND[r.kind] || '', r.reason || '', r.dept ? `Dept: ${r.dept}` : '', r.status ? `Status: ${r.status}` : '', r.updatedBy ? `Last saved by ${r.updatedBy} ${r.updatedAt || ''}` : ''].filter(Boolean).join('  ·  '),
  };
}

/* ───────────────────────── drawing ───────────────────────── */
const PW = 842, PH = 595, M = 22;       // A4 landscape in points, margin
const SC = 2.4;                          // canvas pixels per point
const FONT = 'Arial, Helvetica, sans-serif';

function wrap(ctx, text, w) {
  const out = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= w) { line = t; continue; }
      if (line) out.push(line);
      // a word longer than the box: cut it
      let wd = word;
      while (ctx.measureText(wd).width > w && wd.length > 1) {
        let k = wd.length; while (k > 1 && ctx.measureText(wd.slice(0, k)).width > w) k--;
        out.push(wd.slice(0, k)); wd = wd.slice(k);
      }
      line = wd;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

function pageCanvas() {
  const cv = document.createElement('canvas');
  cv.width = Math.round(PW * SC); cv.height = Math.round(PH * SC);
  const ctx = cv.getContext('2d');
  ctx.scale(SC, SC);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PW, PH);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  return { cv, ctx };
}
const font = (ctx, size, bold = false, italic = false) => { ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${FONT}`; };
const box = (ctx, x, y, w, h) => ctx.strokeRect(x, y, w, h);
function textIn(ctx, s, x, y, w, { size = 10, bold = false, align = 'left', lh = 1.25, color = '#000', italic = false } = {}) {
  font(ctx, size, bold, italic); ctx.fillStyle = color;
  const lines = wrap(ctx, s, w);
  lines.forEach((l, i) => {
    const tx = align === 'center' ? x + (w - ctx.measureText(l).width) / 2 : align === 'right' ? x + w - ctx.measureText(l).width : x;
    ctx.fillText(l, tx, y + i * size * lh);
  });
  ctx.fillStyle = '#000';
  return lines.length * size * lh;
}
const linesH = (ctx, s, w, size, bold = false, lh = 1.25) => { font(ctx, size, bold); return wrap(ctx, s, w).length * size * lh; };

/** the header block (company | title | doc no / page) — on every page */
function drawHead(ctx, H, page, pages) {
  const x0 = M, W = PW - 2 * M, y0 = M, h = 40;
  const c1 = 210, c3 = 190, c2 = W - c1 - c3;
  box(ctx, x0, y0, c1, h); box(ctx, x0 + c1, y0, c2, h); box(ctx, x0 + c1 + c2, y0, c3, h);
  const th = linesH(ctx, H.company, c1 - 12, 12, true);
  textIn(ctx, H.company, x0 + 6, y0 + (h - th) / 2, c1 - 12, { size: 12, bold: true, align: 'center' });
  const t2 = linesH(ctx, H.title, c2 - 12, 14, true);
  textIn(ctx, H.title, x0 + c1 + 6, y0 + (h - t2) / 2, c2 - 12, { size: 14, bold: true, align: 'center' });
  const xr = x0 + c1 + c2, lw = 62;
  ctx.beginPath(); ctx.moveTo(xr, y0 + h / 2); ctx.lineTo(xr + c3, y0 + h / 2); ctx.moveTo(xr + lw, y0); ctx.lineTo(xr + lw, y0 + h); ctx.stroke();
  textIn(ctx, 'DOC. No', xr + 4, y0 + 6, lw - 8, { size: 9, bold: true });
  textIn(ctx, H.docNo, xr + lw + 4, y0 + 6, c3 - lw - 8, { size: 9.5, bold: true });
  textIn(ctx, 'PAGE NO', xr + 4, y0 + h / 2 + 6, lw - 8, { size: 9, bold: true });
  textIn(ctx, `${String(page).padStart(2, '0')} OF ${pages}`, xr + lw + 4, y0 + h / 2 + 6, c3 - lw - 8, { size: 9.5, bold: true });
  return y0 + h;
}

/** page 1: the form; the text gets smaller (down to 7.5 px) until everything fits */
function drawForm(ctx, F, page, pages, size, grow = 0) {   // grow: extra height of every writing row (fills the page, as the paper)
  const x0 = M, W = PW - 2 * M;
  let y = drawHead(ctx, F.head, page, pages);
  const c1 = 210, c3 = 190, c2 = W - c1 - c3;
  // EQUIP / DATE | HALL NO | REVISE NO / REV DATE
  const h2 = 34;
  box(ctx, x0, y, c1, h2); box(ctx, x0 + c1, y, c2, h2); box(ctx, x0 + c1 + c2, y, c3, h2);
  textIn(ctx, `STAGE -  ${F.equip}`, x0 + 6, y + 5, c1 - 12, { size: 10, bold: true });
  textIn(ctx, `DATE  -  ${F.date}`, x0 + 6, y + 19, c1 - 12, { size: 10, bold: true });
  textIn(ctx, `HALL NO-  ${F.hall}`, x0 + c1 + 6, y + 11, c2 - 12, { size: 11, bold: true });
  const xr = x0 + c1 + c2, a = 62, b = 30, c = 42;
  ctx.beginPath(); for (const dx of [a, a + b, a + b + c]) { ctx.moveTo(xr + dx, y); ctx.lineTo(xr + dx, y + h2); } ctx.stroke();
  textIn(ctx, 'REVISE NO.', xr + 3, y + 11, a - 6, { size: 9, bold: true, align: 'center' });
  textIn(ctx, F.head.revNo, xr + a + 2, y + 11, b - 4, { size: 10, align: 'center' });
  textIn(ctx, 'REV Date', xr + a + b + 2, y + 11, c - 4, { size: 9, bold: true, align: 'center' });
  textIn(ctx, F.head.revDate, xr + a + b + c + 2, y + 11, c3 - a - b - c - 4, { size: 9.5, align: 'center' });
  y += h2;

  const P = 5, LBL = 150;                      // inner padding, label column
  const full = (label, text, minH = 22) => {
    const h = Math.max(minH + grow, linesH(ctx, text, W - LBL - 2 * P, size) + 2 * P, linesH(ctx, label, LBL - 2 * P, size, true) + 2 * P);
    box(ctx, x0, y, W, h); ctx.beginPath(); ctx.moveTo(x0 + LBL, y); ctx.lineTo(x0 + LBL, y + h); ctx.stroke();
    textIn(ctx, label, x0 + P, y + P, LBL - 2 * P, { size, bold: true });
    textIn(ctx, text, x0 + LBL + P, y + P, W - LBL - 2 * P, { size });
    y += h;
  };
  const band = (label) => { const h = size * 1.25 + 2 * P; box(ctx, x0, y, W, h); ctx.fillStyle = '#F2F2F2'; ctx.fillRect(x0 + 0.5, y + 0.5, W - 1, h - 1); ctx.fillStyle = '#000'; textIn(ctx, label, x0 + P, y + P, W - 2 * P, { size, bold: true }); y += h; };
  full('Identification of Problem', F.problem, 30);
  full('Correction', F.correction, 26);
  band('Why- why Analysis');
  const qW = W * 0.55, ansL = 30;
  F.whys.forEach((w, k) => {
    const h = Math.max(18 + grow * 0.6, linesH(ctx, w.q, qW - 46 - 2 * P, size) + 2 * P, linesH(ctx, w.a, W - qW - ansL - 2 * P, size) + 2 * P);
    box(ctx, x0, y, W, h); ctx.beginPath(); ctx.moveTo(x0 + qW, y); ctx.lineTo(x0 + qW, y + h); ctx.stroke();
    textIn(ctx, `Why ${k + 1}`, x0 + P, y + P, 40, { size, bold: true });
    textIn(ctx, w.q, x0 + 46, y + P, qW - 46 - 2 * P, { size });
    textIn(ctx, 'Ans.', x0 + qW + P, y + P, ansL, { size, bold: true });
    textIn(ctx, w.a, x0 + qW + ansL + P, y + P, W - qW - ansL - 2 * P, { size });
    y += h;
  });
  full('Root Cause:-', F.rootCause, 26);
  band('Implementation of Action plan:-');
  const tW = 110, rW = 180, aW = W - tW - rW;
  const action = (label, a) => {
    const h = Math.max(30 + grow, linesH(ctx, a.text, aW - LBL - 2 * P, size) + 2 * P, linesH(ctx, a.resp, rW - 2 * P, size) + size * 1.3 + 2 * P);
    box(ctx, x0, y, W, h); ctx.beginPath();
    for (const dx of [LBL, aW, aW + tW]) { ctx.moveTo(x0 + dx, y); ctx.lineTo(x0 + dx, y + h); }
    ctx.stroke();
    textIn(ctx, label, x0 + P, y + P, LBL - 2 * P, { size, bold: true });
    textIn(ctx, a.text, x0 + LBL + P, y + P, aW - LBL - 2 * P, { size });
    textIn(ctx, 'Target Date', x0 + aW + P, y + P, tW - 2 * P, { size: size * 0.9, bold: true, align: 'center' });
    textIn(ctx, a.target, x0 + aW + P, y + P + size * 1.35, tW - 2 * P, { size, align: 'center' });
    textIn(ctx, 'RESPONSIBILITY', x0 + aW + tW + P, y + P, rW - 2 * P, { size: size * 0.9, bold: true, align: 'center' });
    textIn(ctx, a.resp, x0 + aW + tW + P, y + P + size * 1.35, rW - 2 * P, { size, align: 'center' });
    y += h;
  };
  action('Corrective Action', F.corrective);
  action('Preventive Action', F.preventive);
  // verification
  const vText = [F.verify.implemented, F.verify.note].filter(Boolean).join(' — ');
  const vh = Math.max(32 + grow, linesH(ctx, vText, aW + tW - LBL - 2 * P, size) + size * 1.3 + 2 * P);
  box(ctx, x0, y, W, vh); ctx.beginPath(); for (const dx of [LBL, aW + tW]) { ctx.moveTo(x0 + dx, y); ctx.lineTo(x0 + dx, y + vh); } ctx.stroke();
  textIn(ctx, 'Verification of Implemented Action plan', x0 + P, y + P, LBL - 2 * P, { size, bold: true });
  textIn(ctx, 'Implemented', x0 + LBL + P, y + P, aW + tW - LBL - 2 * P, { size: size * 0.9, bold: true });
  textIn(ctx, vText, x0 + LBL + P, y + P + size * 1.35, aW + tW - LBL - 2 * P, { size });
  textIn(ctx, 'sign.', x0 + aW + tW + P, y + P, rW - 2 * P, { size: size * 0.9, bold: true });
  textIn(ctx, F.verify.sign, x0 + aW + tW + P, y + P + size * 1.35, rW - 2 * P, { size });
  y += vh;
  return y;
}

function drawFoot(ctx, F, note) {
  textIn(ctx, `${F.foot}${note ? `  ·  ${note}` : ''}`, M, PH - M + 4, PW - 2 * M - 150, { size: 7.5, color: '#555' });
  textIn(ctx, 'Dixon Line Pulse', PW - M - 150, PH - M + 4, 150, { size: 7.5, color: '#555', align: 'right' });
}

/** evidence photos: 2 × 2 on a page, each fitted in its cell with its file name */
async function drawPhotos(ctx, F, page, pages, photos) {
  const y0 = drawHead(ctx, F.head, page, pages) + 10;
  textIn(ctx, `Evidence — ${F.date}${F.equip ? ` · ${F.equip}` : ''}`, M, y0, PW - 2 * M, { size: 12, bold: true });
  const top = y0 + 22, cw = (PW - 2 * M - 12) / 2, ch = (PH - M - top - 22) / 2;
  photos.forEach((p, i) => {
    const cx = M + (i % 2) * (cw + 12), cy = top + Math.floor(i / 2) * (ch + 10);
    box(ctx, cx, cy, cw, ch);
    const ih = ch - 18;
    if (p.img) {
      const r = Math.min((cw - 8) / p.img.width, (ih - 6) / p.img.height);
      const w = p.img.width * r, h = p.img.height * r;
      ctx.drawImage(p.img, cx + (cw - w) / 2, cy + 4 + (ih - 6 - h) / 2, w, h);
    } else textIn(ctx, '(picture could not be read)', cx + 6, cy + ih / 2, cw - 12, { size: 10, align: 'center', color: '#888' });
    textIn(ctx, `${i + 1 + (page - 2) * 4}. ${p.name || ''}`, cx + 6, cy + ch - 15, cw - 12, { size: 8.5, color: '#333' });
  });
}

const loadImg = (url) => new Promise((res) => { if (!url) { res(null); return; } const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });

/** one or more RCAs → pages (canvases) */
export async function capaPages(list, head, fileUrl = async () => null) {
  const out = [];
  for (const r of list) {
    const F = capaRows(r, head);
    const ev = (r.evidence || []).filter((e) => /^image\//.test(e.type || '') || /\.(jpe?g|png|webp|gif)$/i.test(e.name || ''));
    const other = (r.evidence || []).filter((e) => !ev.includes(e));
    const photos = await Promise.all(ev.map(async (e) => ({ name: e.name, img: await loadImg(await fileUrl(e.id).catch(() => null)) })));
    const pages = 1 + Math.ceil(photos.length / 4);
    // page 1: shrink the text until the form fits on the page
    let size = 10, cv, ctx;
    let end;
    for (;;) {
      ({ cv, ctx } = pageCanvas());
      end = drawForm(ctx, F, 1, pages, size);
      if (end <= PH - M - 4 || size <= 7.5) break;
      size -= 0.5;
    }
    // room left at the bottom: the writing rows grow so the form fills the page (rows: 3 full + 5 whys × 0.6 + 2 actions + verification)
    const room = PH - M - 10 - end;
    if (room > 8) {
      let g = room / 9;
      for (let k = 0; k < 4; k++) {
        ({ cv, ctx } = pageCanvas());
        end = drawForm(ctx, F, 1, pages, size, g);
        if (end <= PH - M - 4) break;
        g *= 0.8;
      }
      if (end > PH - M - 4) { ({ cv, ctx } = pageCanvas()); drawForm(ctx, F, 1, pages, size, 0); }
    }
    drawFoot(ctx, F, [photos.length ? `Evidence: ${photos.length} photo${photos.length > 1 ? 's' : ''} on the next page${photos.length > 4 ? 's' : ''}` : '', other.length ? `Other files: ${other.map((e) => e.name).join(', ')}` : ''].filter(Boolean).join('  ·  '));
    out.push(cv);
    for (let p = 0; p < photos.length; p += 4) {
      const pg = pageCanvas();
      await drawPhotos(pg.ctx, F, 2 + p / 4, pages, photos.slice(p, p + 4));
      drawFoot(pg.ctx, F, '');
      out.push(pg.cv);
    }
  }
  return out;
}

/* ───────────────────────── PDF file ───────────────────────── */
const enc = new TextEncoder();
const b64bytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

/** JPEG pages → PDF bytes (A4 landscape, one image per page). jpgs = [{ bytes, w, h }] */
export function pdfFromJpegs(jpgs, title = 'CAPA') {
  const parts = []; const offs = []; let len = 0;
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = jpgs.length;
  // 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const kids = jpgs.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  obj(3, () => add(`<< /Title (${String(title).replace(/[()\\]/g, '')}) /Producer (Dixon Line Pulse) >>`));
  jpgs.forEach((j, i) => {
    const p = 4 + i * 3, c = p + 1, im = p + 2;
    obj(p, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${c} 0 R >>`));
    const cs = `q ${PW} 0 0 ${PH} 0 0 cm /Im${i} Do Q`;
    obj(c, () => add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
    obj(im, () => { add(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`); add(j.bytes); add('\nendstream'); });
  });
  const xref = len; const total = 4 + n * 3;
  add(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) add(`${String(offs[k]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

/** RCAs → PDF Blob */
export async function capaPdf(list, head, fileUrl) {
  const pages = await capaPages(list, head, fileUrl);
  const jpgs = pages.map((cv) => ({ bytes: b64bytes(cv.toDataURL('image/jpeg', 0.9).split(',')[1]), w: cv.width, h: cv.height }));
  return new Blob([pdfFromJpegs(jpgs, list.length === 1 ? `CAPA ${list[0].date} Line ${list[0].line} ${list[0].reason}` : `CAPA ${list.length} RCAs`)], { type: 'application/pdf' });
}

export function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
export const capaFileName = (r) => `CAPA_${r.date}_Line${r.line}_${String(r.reason || '').replace(/[^\w-]+/g, '_').slice(0, 40)}.pdf`;

/* ───────────────────────── register (admin) ───────────────────────── */
const an = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** an RCA past its corrective target date and not closed */
export const capaOverdue = (r, today) => r.status !== 'closed' && !!(r.capa?.caTarget || r.targetDate) && (r.capa?.caTarget || r.targetDate) < today;
/** every RCA record of the period as a list, filtered; newest first */
export function registerRows(rca = {}, { from = '', to = '9999-12-31', line = 'all', dept = 'all', status = 'all', q = '', today = '' } = {}, deptOf = (d) => d) {
  const t = an(q);
  return Object.entries(rca || {}).map(([key, r]) => ({ key, ...r }))
    .filter((r) => (!from || r.date >= from) && r.date <= to && (line === 'all' || String(r.line) === String(line))
      && (dept === 'all' || deptOf(r.dept).toLowerCase() === String(dept).toLowerCase())
      && (status === 'all' || (status === 'overdue' ? capaOverdue(r, today) : status === 'open' ? r.status !== 'closed' : status === 'verified' ? r.capa?.implemented === 'yes' : r.status === status))
      && (!t || [r.reason, r.rootCause, r.action, r.preventive, r.owner, r.capa?.equip, r.capa?.problem, r.dept].some((x) => an(x).includes(t))))
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.line).localeCompare(String(b.line)) || a.reason.localeCompare(b.reason));
}
export function registerTotals(rows, today) {
  return {
    all: rows.length, open: rows.filter((r) => r.status !== 'closed').length, closed: rows.filter((r) => r.status === 'closed').length,
    overdue: rows.filter((r) => capaOverdue(r, today)).length, verified: rows.filter((r) => r.capa?.implemented === 'yes').length,
    photos: rows.filter((r) => (r.evidence || []).length).length,
  };
}
