import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCompensatoryAssignments } from '../src/compensatory';
import type { ShiftRecord } from '../src/types';
const staff = [{ id: '1', name: 'テスト担当者' }];
const record = (date: string, code: string, source = '', staffId = '1'): ShiftRecord & { id: string } => ({
  id: `${date}_${staffId}`, date, staffId, code, compensatorySourceDate: source,
});
const holiday = { '2026-09-22': true, '2026-09-23': true };
const work = [record('2026-09-22', 'MO'), record('2026-09-23', 'SH')];

test('addition reorders sources by leave date, independent of previous links', () => {
  const records = [...work, record('2026-09-25', '振休', '2026-09-22'), record('2026-09-24', '振休')];
  const before = structuredClone(records);
  const result = calculateCompensatoryAssignments(staff, records, holiday);
  assert.deepEqual(result.changes.map(x => [x.record.date, x.sourceDate]), [
    ['2026-09-24', '2026-09-22'], ['2026-09-25', '2026-09-23'],
  ]);
  assert.deepEqual(records, before);
});

test('deletion releases an earlier source for the remaining leave', () => {
  const result = calculateCompensatoryAssignments(staff, [...work, record('2026-09-25', '振休', '2026-09-23')], holiday);
  assert.deepEqual(result.changes.map(x => x.sourceDate), ['2026-09-22']);
});

test('invalid sources are cleared, future sources used once, shortage retains leave', () => {
  const result = calculateCompensatoryAssignments(staff, [
    record('2026-09-23', 'MO'), record('2026-09-24', 'MO'),
    record('2026-09-21', '振休', '2026-09-20'), record('2026-09-22', '振休'), record('2026-09-25', '振休', '2026-09-24'),
  ], { '2026-09-23': true });
  assert.deepEqual(result.changes.map(x => x.sourceDate), ['2026-09-23', '']);
  assert.deepEqual(result.unmatched, [{ staffId: '1', date: '2026-09-22' }, { staffId: '1', date: '2026-09-25' }]);
  assert.equal(result.changes[1].record.code, '振休');
});

test('separate staff can use the same day without sharing their own source pools', () => {
  const result = calculateCompensatoryAssignments([...staff, { id: '2', name: '担当者2' }], [
    record('2026-09-22', 'MO'), record('2026-09-22', 'SH', '', '2'),
    record('2026-09-25', '振休'), record('2026-09-25', '振休', '', '2'),
  ], holiday);
  assert.deepEqual(result.changes.map(x => x.sourceDate), ['2026-09-22', '2026-09-22']);
});

test('historical eligibility dates remain unchanged and no pre-start source is used', () => {
  const historical = record('2026-08-31', '振休', '2026-08-01');
  const result = calculateCompensatoryAssignments([{ id: '1', name: '田中リ' }], [
    record('2026-08-01', 'MO'), historical, record('2026-09-03', '振休', '2026-08-01'),
  ], { '2026-08-01': true });
  assert.deepEqual(result.changes.map(x => [x.record.date, x.sourceDate]), [['2026-09-03', '']]);
  assert.equal(historical.compensatorySourceDate, '2026-08-01');
});

test('removed starting-point leave no longer reserves its source; recalculation is idempotent', () => {
  const s = [{ id: '1', name: '高畠' }];
  const records = [record('2026-08-01', 'MO'), record('2026-08-10', '振休')];
  const result = calculateCompensatoryAssignments(s, records, { '2026-08-01': true });
  assert.equal(result.changes[0].sourceDate, '2026-08-01');
  records[1].compensatorySourceDate = result.changes[0].sourceDate;
  assert.equal(calculateCompensatoryAssignments(s, records, { '2026-08-01': true }).changes.length, 0);
});
