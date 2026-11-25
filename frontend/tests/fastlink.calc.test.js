// :5173 → built copy (src/utils/fastLink.js), 19-11-2026: PCs move, TVs / the server PC / ?dev stay
import { describe, it, expect } from 'vitest';
import { shouldLeave, fastUrl } from '../src/utils/fastLink';
const L = (o) => ({ protocol: 'http:', hostname: '192.168.2.111', port: '5173', search: '', hash: '', ...o });
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';
const TVUA = 'Mozilla/5.0 (Linux; Android 14; ACR4KR75P Build/UKR9.250715.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0 Mobile Safari/537.36';
describe('fastLink', () => {
  it('a PC on :5173 moves to the built copy, same search and #', () => {
    expect(shouldLeave({ dev: true, loc: L(), ua: PC })).toBe(true);
    expect(fastUrl(L({ search: '?lines=1,2', hash: '#x' }))).toBe('http://192.168.2.111:8080/ems-dashboard/frontend/dist/?lines=1,2#x');
  });
  it('TVs stay: ?tv link, TV login, Android web view', () => {
    expect(shouldLeave({ dev: true, loc: L({ search: '?tv=main' }), ua: PC })).toBe(false);
    expect(shouldLeave({ dev: true, loc: L(), ua: PC, role: 'tv' })).toBe(false);
    expect(shouldLeave({ dev: true, loc: L(), ua: TVUA })).toBe(false);
  });
  it('the server PC, ?dev, a kept stay, the built copy and other ports stay', () => {
    expect(shouldLeave({ dev: true, loc: L({ hostname: 'localhost' }), ua: PC })).toBe(false);
    expect(shouldLeave({ dev: true, loc: L({ search: '?dev' }), ua: PC })).toBe(false);
    expect(shouldLeave({ dev: true, loc: L(), ua: PC, stay: true })).toBe(false);
    expect(shouldLeave({ dev: false, loc: L(), ua: PC })).toBe(false);
    expect(shouldLeave({ dev: true, loc: L({ port: '8080' }), ua: PC })).toBe(false);
  });
});
