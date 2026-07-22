import { describe, expect, it } from 'vitest';
import { buildCalendarCells, monthAnchorDate } from '../lib/sales-calendar';

describe('sales history calendar behavior', () => {
  it('renders six full weeks so late dates remain reachable', () => {
    const cells = buildCalendarCells('2026-08');

    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: '2026-07-26', day: 26, inMonth: false });
    expect(cells.at(-1)).toEqual({ date: '2026-09-05', day: 5, inMonth: false });
    expect(cells.some((cell) => cell.date === '2026-08-30')).toBe(true);
    expect(cells.some((cell) => cell.date === '2026-08-31')).toBe(true);
  });

  it('selects the first day when moving between months', () => {
    expect(monthAnchorDate('2026-07', 1)).toBe('2026-08-01');
    expect(monthAnchorDate('2026-07', -1)).toBe('2026-06-01');
    expect(monthAnchorDate('2026-12', 1)).toBe('2027-01-01');
  });
});
