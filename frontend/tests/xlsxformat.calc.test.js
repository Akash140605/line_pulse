import { describe, it, expect } from 'vitest';
import { formatCell, generalText, BUILTIN } from '../src/utils/xlsxFormat';

// 20-11-2026: cells shown as Excel shows them (the Report compare preview) — the formats of the plant files and ours
describe('Excel number formats', () => {
  it('General and text: as they are, long decimals cut', () => {
    expect(formatCell('187.111111111', '')).toBe('187.1111');
    expect(formatCell('abc', '0.0%')).toBe('abc');
    expect(formatCell('', '0.0')).toBe('');
    expect(generalText('0.30000000000000004')).toBe('0.3');
    expect(formatCell('12', 'General')).toBe('12');
  });
  it('dates of the plant files: HPR d-mmm, KPI d-mmm-yy, Book1 m/d, built-in 14 as dd-mm-yyyy', () => {
    expect(formatCell('46296', 'd-mmm')).toBe('1-Oct');
    expect(formatCell('46328', '[$-409]d\\-mmm\\-yy;@')).toBe('2-Nov-26');
    expect(formatCell('46296', 'm/d;@')).toBe('10/1');
    expect(formatCell('46296', BUILTIN[14])).toBe('01-10-2026');
    expect(formatCell('46296', 'mmm-yy')).toBe('Oct-26');
    expect(formatCell('46296', 'dddd, mmmm d, yyyy')).toBe('Thursday, October 1, 2026');
    expect(formatCell('46296', 'd-mmm', true)).toBe('2-Oct');   // the 1904 date system
  });
  it('times: h:mm, AM/PM, elapsed hours; minutes vs month', () => {
    expect(formatCell('0.375', 'h:mm;@')).toBe('9:00');
    expect(formatCell('0.37499999', 'h:mm')).toBe('9:00');   // to the second, as Excel
    expect(formatCell('0.75', BUILTIN[18])).toBe('6:00 PM');
    expect(formatCell('1.5', '[h]:mm:ss')).toBe('36:00:00');
    expect(formatCell('0.0423611', 'mm:ss')).toBe('01:00');
    expect(formatCell('46296.5', 'dd-mm-yyyy hh:mm')).toBe('01-10-2026 12:00');
  });
  it('numbers: decimals, Indian grouping, percent, accounting with "-" for zero', () => {
    const acc = '_ * #,##0.00_ ;_ * \\-#,##0.00_ ;_ * "-"??_ ;_ @_ ';
    expect(formatCell('187.1111', acc)).toBe('187.11');
    expect(formatCell('-703.9436', acc)).toBe('-703.94');
    expect(formatCell('0', acc)).toBe('-');
    expect(formatCell('1234567', '#,##0')).toBe('12,34,567');
    expect(formatCell('1234.56', '#,##0.0')).toBe('1,234.6');
    expect(formatCell('0.98278', '0.0%')).toBe('98.3%');
    expect(formatCell('0.5', '0%')).toBe('50%');
    expect(formatCell('2.5', '0')).toBe('3');
    expect(formatCell('-2.5', '0')).toBe('-3');
    expect(formatCell('0.5', '#.00')).toBe('.50');
    expect(formatCell('5', '00')).toBe('05');
    expect(formatCell('1.005', '0.00')).toBe('1.01');
    expect(formatCell('1234567', '#,##0,')).toBe('1,235');
  });
  it('₹ and other literals: currency, brackets, signs', () => {
    const rs = '_ [$₹-4009]\\ * #,##0_ ;_ [$₹-4009]\\ * \\-#,##0_ ;_ [$₹-4009]\\ * "-"??_ ;_ @_ ';
    expect(formatCell('1474.8208', rs)).toBe('₹ 1,475');
    expect(formatCell('-1495', rs)).toBe('₹ -1,495');
    expect(formatCell('1234.5', '"₹"\\ #,##0.00;[Red]"₹"\\ \\-#,##0.00')).toBe('₹ 1,234.50');
    expect(formatCell('-1234.5', '"₹"\\ #,##0.00;[Red]"₹"\\ \\-#,##0.00')).toBe('₹ -1,234.50');
    expect(formatCell('1500', '"₹" #,##0;-"₹" #,##0;"-"')).toBe('₹ 1,500');
    expect(formatCell('-20', '"₹" #,##0;-"₹" #,##0;"-"')).toBe('-₹ 20');
    expect(formatCell('0', '"₹" #,##0;-"₹" #,##0;"-"')).toBe('-');
    expect(formatCell('1.53', '\\(0.0\\)')).toBe('(1.5)');
    expect(formatCell('1.25', '+0.0;-0.0;0.0')).toBe('+1.3');
    expect(formatCell('-1.25', '+0.0;-0.0;0.0')).toBe('-1.3');
    expect(formatCell('5', '#;#,##0')).toBe('5');
    expect(formatCell('12', '0" pcs"')).toBe('12 pcs');
    expect(formatCell('-5', '#,##0 ;(#,##0)')).toBe('(5)');
  });
  it('what it does not draw falls back to the value: scientific, conditions', () => {
    expect(formatCell('12345', '0.00E+00')).toBe('12345');
    expect(formatCell('150', '[>=100]"big";"small"')).toBe('150');
  });
});
