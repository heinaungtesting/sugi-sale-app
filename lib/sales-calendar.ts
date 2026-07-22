export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

export function buildCalendarCells(month: string): CalendarCell[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const dateValue = new Date(start);
    dateValue.setUTCDate(start.getUTCDate() + index);
    const date = dateValue.toISOString().slice(0, 10);
    return {
      date,
      day: dateValue.getUTCDate(),
      inMonth: date.startsWith(month),
    };
  });
}

export function monthAnchorDate(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 10);
}
