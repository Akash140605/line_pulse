// CAPA form of an RCA (utils/capaForm.js): the rows of the paper form, the PDF file, the admin register.
import { describe, it, expect } from 'vitest';
import { capaHead, capaRows, pdfFromJpegs, registerRows, registerTotals, capaOverdue } from '../src/utils/capaForm';

const rec = { date: '2026-11-24', line: 1, kind: 'loss', reason: 'Carton box shortage', dept: 'Kitting Store', rootCause: 'Box not called in time', whys: ['No box at line', 'Store late'],
  action: 'Box buffer 2 h', preventive: 'Kanban card', owner: 'Neeraj', targetDate: '2026-11-26', status: 'submitted', updatedBy: 'admin',
  capa: { equip: 'Packing station', hall: 'Hall 2', whyQ: ['Why did line stop?', 'Why no box?'], paTarget: '2026-12-05', paResp: 'Store head', implemented: 'yes', verifiedBy: 'QA', verifyDate: '2026-11-28' } };

describe('CAPA form', () => {
  it('header: defaults and own values', () => {
    expect(capaHead({})).toMatchObject({ company: 'DIXON TECHNOLOGIES INDIA LIMITED', title: 'CORRECTIVE AND PREVENTIVE ACTION PLAN', docNo: 'DIXON/MAINT/05/20', revNo: '0', revDate: '01-01-2020' });
    expect(capaHead({ docNo: ' QA/7 ' }).docNo).toBe('QA/7');
  });
  it('rows of the paper form from an RCA', () => {
    const F = capaRows(rec, {});
    expect([F.equip, F.date, F.hall]).toEqual(['Packing station', '24-11-2026', 'Hall 2']);
    expect(F.whys[0]).toEqual({ q: 'Why did line stop?', a: 'No box at line' });
    expect(F.whys[4]).toEqual({ q: '', a: '' });
    expect(F.corrective).toEqual({ text: 'Box buffer 2 h', target: '26-11-2026', resp: 'Neeraj' });
    expect(F.preventive).toEqual({ text: 'Kanban card', target: '05-12-2026', resp: 'Store head' });
    expect(F.verify.sign).toBe('QA · 28-11-2026');
    expect(F.problem).toBe('Unplanned loss: Carton box shortage — Line 1, 24-11-2026');   // not written: the loss
  });
  it('identification of problem: the loss when left empty; an older RCA without a CAPA form still makes a form', () => {
    const F = capaRows({ ...rec, capa: undefined });
    expect(F.problem).toBe('Unplanned loss: Carton box shortage — Line 1, 24-11-2026');
    expect(F.hall).toBe(''); expect(F.preventive.resp).toBe('');
  });
  it('PDF file: header, one page per JPEG, xref offsets right', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const b = pdfFromJpegs([{ bytes: jpg, w: 10, h: 7 }, { bytes: jpg, w: 10, h: 7 }], 'T');
    const s = new TextDecoder('latin1').decode(b);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.match(/\/Type \/Page /g).length).toBe(2);
    expect(s).toContain('/Count 2');
    const xref = Number(s.match(/startxref\n(\d+)/)[1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const off = [...s.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    off.forEach((o, k) => expect(s.slice(o).startsWith(`${k + 1} 0 obj`)).toBe(true));
  });
  it('register: filters, overdue, totals', () => {
    const rca = { a: rec, b: { ...rec, date: '2026-11-20', line: 2, reason: 'Motor', status: 'closed', capa: {} }, c: { ...rec, date: '2026-11-10', reason: 'Seal', targetDate: '2026-11-12', capa: {} } };
    const today = '2026-11-24';
    expect(registerRows(rca, { today }).map((r) => r.reason)).toEqual(['Carton box shortage', 'Motor', 'Seal']);
    expect(registerRows(rca, { line: '2', today }).length).toBe(1);
    expect(registerRows(rca, { status: 'overdue', today }).map((r) => r.reason)).toEqual(['Seal']);
    expect(registerRows(rca, { q: 'kanban', today }).length).toBe(3);
    expect(registerRows(rca, { from: '2026-11-15', today }).length).toBe(2);
    expect(capaOverdue(rca.c, today)).toBe(true);
    expect(registerTotals(registerRows(rca, { today }), today)).toMatchObject({ all: 3, open: 2, closed: 1, overdue: 1, verified: 1 });
  });
});
