import type { Staff, ShiftRecord } from './types';

export interface AssignmentChange {
  record: ShiftRecord & { id: string };
  sourceDate: string;
}
const isCompensatory = (code: string) => code === '振休' || code?.startsWith('振休');

/** Rebuild source links in date order, without modifying shift codes or other metadata. */
export function calculateCompensatoryAssignments(
  staff: Staff[],
  records: (ShiftRecord & { id: string })[],
  holidays: Record<string, boolean>,
): { changes: AssignmentChange[]; unmatched: { staffId: string; date: string }[] } {
  const changes: AssignmentChange[] = [];
  const unmatched: { staffId: string; date: string }[] = [];
  for (const person of staff) {
    const tanaka = person.name.includes('田中');
    const takabatake = person.name.includes('高畠');
    const miura = person.name.includes('三浦');
    const sourceStart = tanaka ? '2026-09-01' : miura ? '2026-08-02' : '2026-08-01';
    const targetStart = tanaka ? '2026-09-01' : takabatake ? '2026-08-03' : miura ? '2026-08-05' : '2026-08-01';
    const ownRecords = records.filter(record => record.staffId === person.id);
    const sources = [...new Set(ownRecords.filter(record =>
      record.date >= sourceStart && holidays[record.date] && ['MO', 'SH'].includes(record.code),
    ).map(record => record.date))].sort();
    const used = new Set<string>();
    const targets = ownRecords.filter(record => isCompensatory(record.code) && record.date >= targetStart)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Preserve fixed historical starting points only while both days actually exist.
    const anchor = takabatake ? ['2026-08-03', '2026-08-01'] : miura ? ['2026-08-05', '2026-08-02'] : null;
    const assignments = new Map<string, string>();
    if (anchor) {
      const target = targets.find(record => record.date === anchor[0]);
      if (target && sources.includes(anchor[1])) {
        assignments.set(target.id, anchor[1]);
        used.add(anchor[1]);
      }
    }
    // Existing historical links outside the enabled period remain reserved and untouched.
    ownRecords.filter(record => isCompensatory(record.code) && record.date < targetStart)
      .forEach(record => { if (record.compensatorySourceDate) used.add(record.compensatorySourceDate); });
    for (const target of targets) {
      if (!assignments.has(target.id)) {
        // Sorted sources select the oldest unused past date, then the nearest future date.
        const past = sources.find(date => date <= target.date && !used.has(date));
        const future = sources.find(date => date > target.date && !used.has(date));
        const source = past || future || '';
        assignments.set(target.id, source);
        if (source) used.add(source);
      }
      const sourceDate = assignments.get(target.id)!;
      if (!sourceDate) unmatched.push({ staffId: person.id, date: target.date });
      if ((target.compensatorySourceDate || '') !== sourceDate) changes.push({ record: target, sourceDate });
    }
  }
  return { changes, unmatched };
}
