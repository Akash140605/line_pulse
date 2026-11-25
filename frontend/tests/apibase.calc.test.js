// The API address of a copy of the software (api.js apiBaseFor): the server the page was opened from.
import { describe, it, expect } from 'vitest';
import { apiBaseFor } from '../src/api';

describe('API address', () => {
  it('the plant server: unchanged', () => {
    expect(apiBaseFor({ origin: 'http://192.168.2.111:8080', port: '8080', pathname: '/ems-dashboard/frontend/dist/' })).toBe('http://192.168.2.111:8080/ems-dashboard/backend/api');
  });
  it('a copy on another PC, port or folder', () => {
    expect(apiBaseFor({ origin: 'http://localhost', port: '', pathname: '/ems-dashboard/frontend/dist/index.html' })).toBe('http://localhost/ems-dashboard/backend/api');
    expect(apiBaseFor({ origin: 'http://10.0.0.5:9090', port: '9090', pathname: '/linepulse/frontend/dist/' })).toBe('http://10.0.0.5:9090/linepulse/backend/api');
  });
  it('the development server and unknown pages: the plant server', () => {
    expect(apiBaseFor({ origin: 'http://192.168.2.111:5173', port: '5173', pathname: '/' })).toBe('http://192.168.2.111:8080/ems-dashboard/backend/api');
    expect(apiBaseFor(null)).toBe('http://192.168.2.111:8080/ems-dashboard/backend/api');
  });
});
