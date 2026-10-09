/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { calculateCompensatoryAssignments } from './compensatory';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Calendar, 
  Users, 
  Clock, 
  Settings, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Trash2, 
  GripVertical, 
  Save, 
  X, 
  Lock,
  Printer,
  FileText,
  Edit3,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  db, 
  onSnapshot,
  collection,
  query,
  where,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  getDoc,
  getDocs,
  getDocsFromServer,
  waitForPendingWrites,
  writeBatch,
  orderBy,
  limit
} from './firebase';

// --- Types ---
import { Staff, ShiftCode, TaskCode, AppSettings, ShiftData, TaskData, MemoData, StaffNoteData, DetailedMemoData, ShiftPattern, HolidayData, TaskPattern, CompensatoryData, ShiftRecord } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const PASSWORD = 'ks1311';
const TIMES = Array.from({ length: 25 }, (_, i) => {
  const totalMinutes = 7 * 60 + 30 + i * 30;
  const hour = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60 === 0 ? '00' : '30';
  return `${hour.toString().padStart(2, '0')}:${min}`;
});

const INITIAL_STAFF: Staff[] = [
  { id: '1', name: '田中リ' },
  { id: '2', name: '高畠' },
  { id: '3', name: '三浦' },
];

const INITIAL_SHIFTS: ShiftCode[] = ['SH', 'MO', '研修', '所休', '振休', '有休'];

const INITIAL_TASKS: TaskCode[] = [
  '開店', '閉店', '清掃', 'レジ', '発注・仕入', '接客・採寸', '入荷連絡', '入荷処理', '品出し・倉庫整理', '棚卸', '休憩', 'その他作業', '資料作成'
];

// --- Utils ---
const getDisplayTaskName = (taskCode: string) => {
  if (!taskCode) return '-';
  if (taskCode.startsWith('その他作業:') || taskCode.startsWith('その他作業：')) {
    const memo = taskCode.substring(taskCode.indexOf(':') !== -1 ? taskCode.indexOf(':') + 1 : taskCode.indexOf('：') + 1);
    return `その他：${memo}`;
  }
  if (taskCode.startsWith('資料作成:') || taskCode.startsWith('資料作成：')) {
    const memo = taskCode.substring(taskCode.indexOf(':') !== -1 ? taskCode.indexOf(':') + 1 : taskCode.indexOf('：') + 1);
    return `資料：${memo}`;
  }
  return taskCode;
};

const getPeriodDates = (baseDate: Date) => {
  const d = new Date(baseDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  let startYear = year;
  let startMonth = month;
  if (day < 21) {
    startMonth -= 1;
  }
  
  const startDate = new Date(startYear, startMonth, 21);
  const endDate = new Date(startYear, startMonth + 1, 20);
  
  const dates = [];
  let curr = new Date(startDate);
  while (curr <= endDate) {
    dates.push(new Date(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
};

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getDayName = (date: Date) => {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[date.getDay()];
};

const getWeekOffset = (date: Date) => {
  // Epoch on a Sunday (e.g., Dec 28, 2025)
  const epoch = new Date(2025, 11, 28);
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Adjust current date to Sunday of its week
  current.setDate(current.getDate() - current.getDay());
  
  const diffTime = current.getTime() - epoch.getTime();
  const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000));
  return Math.abs(diffWeeks) % 2; // 0 for Week 1 (奇数週), 1 for Week 2 (偶数週)
};

const getTaskColor = (task: string) => {
  if (!task || task === '空') return 'bg-[#F1F5F9] text-[#94A3B8] border-transparent';
  if (task === '休憩') return 'bg-[#94A3B8] text-white border-transparent';
  
  let baseTask = task;
  if (task.includes(':')) {
    baseTask = task.split(':')[0];
  } else if (task.includes('：')) {
    baseTask = task.split('：')[0];
  }

  const colors: Record<string, string> = {
    '開店': 'bg-[#2563EB] text-white border-transparent',
    '閉店': 'bg-[#1D4ED8] text-white border-transparent',
    '清掃': 'bg-[#059669] text-white border-transparent',
    'レジ': 'bg-[#EA580C] text-white border-transparent',
    '接客・採寸': 'bg-[#7C3AED] text-white border-transparent',
    '発注・仕入': 'bg-[#C2410C] text-white border-transparent',
    '入荷連絡': 'bg-[#3B82F6] text-white border-transparent',
    '入荷処理': 'bg-[#10B981] text-white border-transparent',
    '品出し・倉庫整理': 'bg-[#8B5CF6] text-white border-transparent',
    '棚卸': 'bg-[#9A3412] text-white border-transparent',
    'その他作業': 'bg-[#0EA5E9] text-white border-transparent',
    '資料作成': 'bg-[#6366F1] text-white border-transparent',
  };

  if (colors[baseTask]) return colors[baseTask];
  
  const palette = [
    'bg-[#F97316] text-white border-transparent',
    'bg-[#3B82F6] text-white border-transparent',
    'bg-[#10B981] text-white border-transparent',
    'bg-[#6366F1] text-white border-transparent',
    'bg-[#F43F5E] text-white border-transparent',
    'bg-[#D97706] text-white border-transparent',
    'bg-[#8B5CF6] text-white border-transparent',
    'bg-[#06B6D4] text-white border-transparent',
    'bg-[#84CC16] text-white border-transparent',
    'bg-[#D946EF] text-white border-transparent',
    'bg-[#14B8A6] text-white border-transparent',
    'bg-[#FACC15] text-black border-transparent',
    'bg-[#EC4899] text-white border-transparent',
  ];
  
  let hash = 0;
  for (let i = 0; i < baseTask.length; i++) {
    hash = baseTask.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
};

const getShiftBadgeStyle = (code: string) => {
  const baseCode = code.includes('振休') ? '振休' : code;
  switch (baseCode) {
    case 'S':
    case 'SH': return 'bg-[#E0E7FF] text-[#4338CA]';
    case 'O':
    case 'MO': return 'bg-[#FEF3C7] text-[#92400E]';
    case '研修': return 'bg-[#F3E8FF] text-[#7E22CE]';
    case '所休':
    case '振休':
    case '有休': return 'bg-[#F1F5F9] text-[#64748B]';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const getDisplayShiftCode = (code: string, compensatorySourceDate?: string) => {
  if (!code) return '';
  if (code === '振休' || code.startsWith('振休')) {
    if (compensatorySourceDate) {
      const parts = compensatorySourceDate.split('-');
      if (parts.length === 3) {
        const day = parseInt(parts[2], 10);
        if (!isNaN(day)) return `${day}振`;
      }
    }
    const num = code.replace('振休', '').trim();
    return num ? `${num}振` : '振';
  }
  return code.substring(0, 1);
};

/** タスク選択用ポップアップ */
const TaskSelectorPopup = ({ 
  options, 
  onSelect, 
  onClose, 
  type 
}: { 
  options: string[], 
  onSelect: (val: string) => void, 
  onClose: () => void,
  type: 'plan' | 'result'
}) => {
  return (
    <div 
      className={cn(
        "absolute top-0 z-[60] bg-white border-2 border-sub-navy rounded-lg shadow-2xl p-2 w-[240px] grid grid-cols-2 gap-1 animate-in fade-in zoom-in duration-100",
        type === 'plan' ? "left-full ml-2" : "right-full mr-2"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button 
        onClick={() => onSelect('')}
        className="col-span-2 p-2 rounded bg-slate-100 text-slate-500 font-bold text-[10px] hover:bg-slate-200"
      >
        クリア (-)
      </button>
      {options.map(abbr => (
        <button
          key={abbr}
          onClick={() => onSelect(abbr)}
          className={cn(
            "p-2 rounded text-[10px] font-black transition-all hover:scale-105 active:scale-95 truncate",
            getTaskColor(abbr)
          )}
        >
          {abbr}
        </button>
      ))}
    </div>
  );
};

// --- Components ---

/** 認証用モーダル */
const PasswordModal = ({ isOpen, onClose, onConfirm }: { isOpen: boolean, onClose: () => void, onConfirm: () => void }) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === PASSWORD) {
      onConfirm();
      setInput('');
      setError(false);
    } else {
      setError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="bg-sub-navy p-6 text-white flex items-center gap-3">
          <div className="bg-main-orange w-8 h-8 rounded flex items-center justify-center font-black text-lg">K</div>
          <h3 className="text-xl font-bold">認証が必要です</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-600">パスワードを入力してください</label>
            <input 
              type="password" 
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className={cn(
                "w-full px-4 py-3 rounded-md border-2 outline-none transition-all text-lg tracking-widest text-center",
                error ? "border-red-500 bg-red-50" : "border-border-light focus:border-main-orange"
              )}
              placeholder="••••••"
            />
            {error && <p className="text-red-500 text-sm font-medium text-center">パスワードが正しくありません</p>}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-md font-bold text-slate-500 hover:bg-slate-100 transition-colors">キャンセル</button>
            <button type="submit" className="flex-1 py-3 rounded-md font-bold bg-main-orange text-white hover:opacity-90 shadow-lg shadow-orange-200 transition-all">認証</button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

/** メモ編集用モーダル */
const MemoModal = ({ isOpen, date, initialValue, onClose, onSave }: { isOpen: boolean, date: string, initialValue: string, onClose: () => void, onSave: (val: string) => void }) => {
  const [value, setValue] = useState(initialValue);
  useEffect(() => { if (isOpen) setValue(initialValue); }, [isOpen, initialValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="bg-[#FFFBEB] p-6 border-b border-[#FEF3C7] flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black text-slate-800">{date} のメモ</h3>
            <p className="text-sm text-[#92400E] font-semibold">この日の特記事項や連絡事項を入力してください</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-amber-100 rounded-full">
            <X className="w-6 h-6 text-[#92400E]" />
          </button>
        </div>
        <div className="p-6">
          <textarea 
            autoFocus value={value} onChange={(e) => setValue(e.target.value)}
            className="w-full h-64 p-4 rounded-lg border border-[#FDE68A] focus:border-main-orange outline-none resize-none text-lg bg-white text-[#78350F]"
            placeholder="メモを入力..."
          />
        </div>
        <div className="p-6 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded-md font-bold text-slate-500 hover:bg-slate-200 transition-colors">キャンセル</button>
          <button onClick={() => onSave(value)} className="px-8 py-2 rounded-md font-bold bg-main-orange text-white hover:opacity-90 transition-all flex items-center gap-2">
            <Save className="w-5 h-5" /> 保存
          </button>
        </div>
      </motion.div>
    </div>
  );
};

/** 遅延保存付きテキスト入力 (連絡事項/詳細メモ用) */
const BufferedInput = ({ 
  value, 
  onSave, 
  placeholder, 
  className, 
  isTextArea = false 
}: { 
  value: string, 
  onSave: (val: string) => void, 
  placeholder?: string, 
  className?: string,
  isTextArea?: boolean
}) => {
  const [localVal, setLocalVal] = useState(value);
  
  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  const handleBlur = () => {
    if (localVal !== value) {
      onSave(localVal);
    }
  };

  const commonProps = {
    value: localVal,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setLocalVal(e.target.value),
    onBlur: handleBlur,
    placeholder,
    className,
    onClick: (e: React.MouseEvent) => e.stopPropagation()
  };

  return isTextArea ? (
    <textarea {...commonProps} />
  ) : (
    <input type="text" {...commonProps} />
  );
};

const SortableItem = ({ id, name, onRemove, onEdit }: { id: string, name: string, onRemove: () => void, onEdit: (val: string) => void, key?: string }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(name);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editVal.trim() && editVal !== name) {
      onEdit(editVal.trim());
    } else {
      setEditVal(name);
    }
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 bg-white border rounded-lg transition-all",
        isDragging ? "shadow-xl border-main-orange scale-[1.02]" : "shadow-sm border-border-light"
      )}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-slate-100 rounded">
        <GripVertical className="w-5 h-5 text-slate-400" />
      </div>
      
      <div className="flex-1">
        {isEditing ? (
          <input 
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
            className="w-full px-2 py-1 border-b-2 border-main-orange outline-none font-bold"
          />
        ) : (
          <span 
            onClick={() => setIsEditing(true)}
            className="font-bold text-slate-700 cursor-text hover:text-main-orange transition-colors"
          >
            {name}
          </span>
        )}
      </div>

      <button 
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all relative z-50"
      >
        <Trash2 className="w-5 h-5" />
      </button>
    </div>
  );
};

// --- Optimized Sub-components ---

const ShiftCell = React.memo(({ 
  shiftCode, 
  compensatorySourceDate,
  isEditMode, 
  shiftAbbreviations, 
  updateShift, 
  dateStr, 
  staffId, 
  onCellClick,
  getDisplayShiftCode,
  getShiftBadgeStyle,
  isSelected,
  isToday,
  isLocked = false,
  updateShiftLock
}: { 
  shiftCode: string, 
  compensatorySourceDate?: string,
  isEditMode: boolean, 
  shiftAbbreviations: string[], 
  updateShift: (d: string, s: string, c: string) => void,
  dateStr: string,
  staffId: string,
  onCellClick: () => void,
  getDisplayShiftCode: (c: string, src?: string) => string,
  getShiftBadgeStyle: (c: string) => string,
  isSelected: boolean,
  isToday?: boolean,
  isLocked?: boolean,
  updateShiftLock?: (d: string, s: string, l: boolean) => void
}) => {
  const isAdvanceBorrowed = compensatorySourceDate ? compensatorySourceDate > dateStr : false;
  const tooltipText = compensatorySourceDate 
    ? `振休 (${isAdvanceBorrowed ? '前借り' : ''}振替元: ${compensatorySourceDate})`
    : (shiftCode.startsWith('振休') ? '振休' : undefined);

  return (
    <td className={cn(
      "border-r border-b border-border-light text-center h-12 p-0 group print:h-[22px] print:p-0 print:border-slate-300",
      isEditMode && "h-14 min-h-[56px] p-0.5",
      isToday && "bg-[#FFF7ED]/35 border-x-2 border-x-main-orange/20",
      isSelected && "bg-orange-50/60 font-medium"
    )}>
      {isEditMode ? (
        <div className="flex flex-col items-center justify-center h-full w-full py-0.5 px-1 min-h-[46px]">
          <select 
            value={shiftCode === '振休' || shiftCode.startsWith('振休') ? '振休' : shiftCode}
            disabled={isLocked}
            onChange={(e) => updateShift(dateStr, staffId, e.target.value)}
            className={cn(
              "w-full bg-transparent outline-none text-center font-black cursor-pointer text-xs h-6 max-h-6",
              isLocked && "opacity-55 cursor-not-allowed text-slate-400"
            )}
            title={tooltipText}
          >
            <option value="">-</option>
            {shiftAbbreviations.map(abbr => {
              if (abbr === '振休') {
                const isCurrentFurikyu = shiftCode === '振休' || shiftCode.startsWith('振休');
                const displayLabel = isCurrentFurikyu && compensatorySourceDate
                  ? getDisplayShiftCode(shiftCode, compensatorySourceDate)
                  : '振休';
                return (
                  <option key={abbr} value="振休">
                    {displayLabel}
                  </option>
                );
              }
              return <option key={abbr} value={abbr}>{abbr}</option>;
            })}
          </select>
          
          <div className="flex items-center justify-center gap-1.5 leading-none select-none touch-none mt-0.5">
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (updateShiftLock) updateShiftLock(dateStr, staffId, !isLocked);
              }}
              className={cn(
                "relative inline-flex h-3 w-6 shrink-0 cursor-pointer rounded-full border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center",
                isLocked ? "bg-red-500" : "bg-slate-200"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-2 w-2 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  isLocked ? "translate-x-3.5" : "translate-x-0.5"
                )}
              />
            </button>
            <Lock className={cn("w-2.5 h-2.5 transition-colors", isLocked ? "text-red-500" : "text-slate-300")} />
          </div>
        </div>
      ) : (
        <div 
          onClick={onCellClick}
          className="w-full h-full flex flex-col items-center justify-center cursor-pointer group py-1"
          title={tooltipText}
        >
          {shiftCode ? (
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <span className={cn(
                "w-7 h-6 rounded flex items-center justify-center text-[10px] font-black shadow-sm transition-transform group-hover:scale-110 print:w-6 print:h-[18px] print:text-[8px] print:rounded-sm",
                getShiftBadgeStyle(shiftCode)
              )}>
                {getDisplayShiftCode(shiftCode, compensatorySourceDate)}
              </span>
              {isLocked && (
                <Lock className="w-2.5 h-2.5 text-red-500 print:w-2 print:h-2" />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <span className="text-slate-200 group-hover:text-slate-400 transition-colors print:text-[8px] print:text-slate-300">
                -
              </span>
              {isLocked && (
                <Lock className="w-2.5 h-2.5 text-red-500 print:w-2 print:h-2" />
              )}
            </div>
          )}
        </div>
      )}
    </td>
  );
});

const isHolidayShift = (code: string) => {
  if (!code) return false;
  // ③「有休」はカウント対象外
  if (code.includes('有休')) return false;
  // ②「所定休」「振休」
  return code === '所休' || code === '所定休' || code.startsWith('所休') || code.startsWith('所定休') || code.includes('振休');
};

// 2026年9月度終了時点（9/20終了時点）の計算結果は全員「0」
// 2026年10月度（2026/09/21〜2026/10/20）から実際の過不足計算を開始し、前月過不足を翌月に繰り越す
const calculateStaffHolidayBalance = (
  personId: string,
  targetDates: Date[],
  allShifts: ShiftData,
  allHolidays: Record<string, boolean>,
  formatDateFn: (d: Date) => string
) => {
  if (!targetDates || targetDates.length === 0) {
    return {
      targetCount: 0,
      staffCount: 0,
      prevCarryover: 0,
      adjustedTarget: 0,
      diff: 0
    };
  }

  // 対象月度の終了日（20日）から年月度を取得
  const lastDate = targetDates[targetDates.length - 1];
  const targetYear = lastDate.getFullYear();
  const targetMonth = lastDate.getMonth() + 1; // 1-12

  // 当月のカレンダー休日設定数
  const currentTargetCount = targetDates.filter(d => allHolidays[formatDateFn(d)]).length;
  // 当月の担当者所休・振休数（有休は対象外）
  const currentStaffCount = targetDates.reduce((count, date) => {
    const code = allShifts[formatDateFn(date)]?.[personId] || '';
    return isHolidayShift(code) ? count + 1 : count;
  }, 0);

  // 2026年9月度（2026/08/21〜2026/09/20）終了時点までは全員「0」
  const isSep2026OrEarlier = targetYear < 2026 || (targetYear === 2026 && targetMonth <= 9);
  if (isSep2026OrEarlier) {
    return {
      targetCount: currentTargetCount,
      staffCount: currentStaffCount,
      prevCarryover: 0,
      adjustedTarget: currentTargetCount,
      diff: 0
    };
  }

  // 2026年10月度（2026/09/21〜2026/10/20）以降：
  // 10月度から対象月度の前月度まで月度ごとに過不足を累計（9月度終了時点は0としてスタート）
  let cumulativeCarryover = 0;
  let currY = 2026;
  let currM = 10;

  while (currY < targetYear || (currY === targetYear && currM < targetMonth)) {
    // currY年currM月度の日付配列（currM月20日を含む月度）
    const mDates = getPeriodDates(new Date(currY, currM - 1, 20));
    const mTargetCount = mDates.filter(d => allHolidays[formatDateFn(d)]).length;
    const mStaffCount = mDates.reduce((count, date) => {
      const code = allShifts[formatDateFn(date)]?.[personId] || '';
      return isHolidayShift(code) ? count + 1 : count;
    }, 0);

    // 各月度の過不足（取得数 - 休日設定数）を累積
    cumulativeCarryover += (mStaffCount - mTargetCount);

    currM++;
    if (currM > 12) {
      currM = 1;
      currY++;
    }
  }

  // （例）前月過不足が -1 で今月休日設定が 9日 なら、今月休日は 9 - (-1) = 10日
  const adjustedTarget = currentTargetCount - cumulativeCarryover;
  const diff = currentStaffCount - adjustedTarget;

  return {
    targetCount: currentTargetCount,
    staffCount: currentStaffCount,
    prevCarryover: cumulativeCarryover,
    adjustedTarget,
    diff
  };
};

const MonthlyViewRow = React.memo(({ 
  person, 
  periodDates, 
  shifts, 
  holidays = {},
  compensatoryDates = {},
  isEditMode, 
  shiftAbbreviations, 
  updateShift, 
  onCellClick, 
  formatDate,
  getDisplayShiftCode,
  getShiftBadgeStyle,
  selectedDate,
  todayStr,
  lockedShifts = {},
  updateShiftLock = () => {}
}: {
  person: Staff,
  periodDates: Date[],
  shifts: ShiftData,
  holidays?: Record<string, boolean>,
  compensatoryDates?: CompensatoryData,
  isEditMode: boolean, 
  shiftAbbreviations: string[], 
  updateShift: (d: string, s: string, c: string) => void,
  onCellClick: (d: string, s: string) => void,
  formatDate: (d: Date) => string,
  getDisplayShiftCode: (c: string, src?: string) => string,
  getShiftBadgeStyle: (c: string) => string,
  selectedDate: string,
  todayStr?: string,
  lockedShifts?: Record<string, Record<string, boolean>>,
  updateShiftLock?: (d: string, s: string, l: boolean) => void
}) => {
  // 休日日数・過不足の累計計算
  const { targetCount, staffCount, prevCarryover, adjustedTarget, diff } = useMemo(() => {
    return calculateStaffHolidayBalance(person.id, periodDates, shifts, holidays, formatDate);
  }, [person.id, periodDates, shifts, holidays, formatDate]);

  return (
    <tr className="hover:bg-slate-50 transition-colors print:h-[22px]">
      <td className="sticky left-0 z-20 bg-white p-3 border-r border-b border-border-light shadow-[2px_0_5px_rgba(0,0,0,0.05)] print:p-0.5 print:pl-1.5 print:bg-[#F8FAFC] print:border-slate-300">
        <div className="flex flex-col">
          <span className="font-bold text-sub-navy text-sm truncate print:text-[9px] print:leading-tight">{person.name}</span>
          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider print:hidden">Staff ID: {person.id.substring(0, 4)}</span>
        </div>
      </td>
      {periodDates.map(date => {
        const dateStr = formatDate(date);
        const shiftCode = shifts[dateStr]?.[person.id] || '';
        const compDate = compensatoryDates?.[dateStr]?.[person.id];
        const isSelected = selectedDate === dateStr;
        const isToday = todayStr ? dateStr === todayStr : false;
        const isLocked = lockedShifts?.[dateStr]?.[person.id] || false;
        return (
          <ShiftCell 
            key={`${person.id}-${dateStr}`}
            shiftCode={shiftCode}
            compensatorySourceDate={compDate}
            isEditMode={isEditMode}
            shiftAbbreviations={shiftAbbreviations}
            updateShift={updateShift}
            dateStr={dateStr}
            staffId={person.id}
            onCellClick={() => onCellClick(dateStr, person.id)}
            getDisplayShiftCode={getDisplayShiftCode}
            getShiftBadgeStyle={getShiftBadgeStyle}
            isSelected={isSelected}
            isToday={isToday}
            isLocked={isLocked}
            updateShiftLock={updateShiftLock}
          />
        );
      })}
      {/* ●/20の隣の休日日数セル（約半分の幅 w-11 で文字切れなし、数値のみ表示） */}
      <td 
        title={prevCarryover !== 0 
          ? `公休基準: ${targetCount}日\n前月繰越: ${prevCarryover > 0 ? '+' : ''}${prevCarryover}日\n当月目標: ${adjustedTarget}日\n当月取得: ${staffCount}日\n過不足: ${diff > 0 ? '+' : ''}${diff}`
          : `公休基準: ${targetCount}日\n当月取得: ${staffCount}日\n過不足: ${diff > 0 ? '+' : ''}${diff}`}
        className={cn(
          "border-r border-b border-border-light text-center h-12 p-0 font-bold print:h-[22px] print:p-0 print:border-slate-300 bg-white cursor-default w-11 min-w-[44px] max-w-[44px]",
          isEditMode && "h-14 min-h-[56px]"
        )}
      >
        <div className="flex items-center justify-center h-full w-full">
          <span className={cn(
            "font-black text-xs print:text-[8px]",
            diff < 0 ? "text-red-500" : diff > 0 ? "text-blue-600" : "text-slate-600"
          )}>
            {diff}
          </span>
        </div>
      </td>
    </tr>
  );
});

const ShiftGridTable = React.memo(({
  dates,
  title,
  isEditMode,
  shifts,
  memos,
  holidays,
  compensatoryDates = {},
  staff,
  shiftAbbreviations,
  updateShift,
  updateHoliday,
  onCellClick,
  formatDate,
  getDisplayShiftCode,
  getShiftBadgeStyle,
  selectedDate,
  setSelectedDate,
  todayStr,
  lockedShifts,
  updateShiftLock,
}: {
  dates: Date[],
  title: string,
  isEditMode: boolean,
  shifts: ShiftData,
  memos: Record<string, string>,
  holidays: Record<string, boolean>,
  compensatoryDates?: CompensatoryData,
  staff: Staff[],
  shiftAbbreviations: string[],
  updateShift: (d: string, s: string, c: string) => void,
  updateHoliday: (date: string, isH: boolean) => void,
  onCellClick: (d: string, s: string) => void,
  formatDate: (d: Date) => string,
  getDisplayShiftCode: (c: string, src?: string) => string,
  getShiftBadgeStyle: (c: string) => string,
  selectedDate: string,
  setSelectedDate: (d: string) => void,
  todayStr: string,
  lockedShifts: Record<string, Record<string, boolean>>,
  updateShiftLock: (d: string, s: string, l: boolean) => void,
}) => {
  return (
    <div className="bg-white rounded-xl border border-border-light shadow-sm overflow-hidden flex flex-col shrink-0">
      <div className="px-5 py-3 bg-[#F8FAFC] border-b border-border-light flex justify-between items-center shrink-0">
        <span className="font-extrabold text-[#1E293B] text-sm">{title}</span>
      </div>
      
      <div className="overflow-x-auto relative">
        <table className="w-full border-collapse table-fixed min-w-[1200px]">
          <thead className="sticky top-0 z-30 bg-[#F8FAFC] text-[#64748B]">
            {/* Holiday Row */}
            <tr className={cn(!isEditMode && "hidden")}>
              <th className="sticky left-0 z-40 bg-[#F8FAFC] w-32 p-1 border-r border-b border-border-light font-black text-slate-400 text-[10px] shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                休日設定
              </th>
              {dates.map(date => {
                const dateStr = formatDate(date);
                const isToday = dateStr === todayStr;
                return (
                  <th 
                    key={`holiday-${dateStr}`} 
                    className={cn(
                      "p-1 border-r border-b border-border-light bg-slate-50",
                      isToday && "bg-[#FFF7ED]/35 border-x-2 border-x-main-orange/23"
                    )}
                  >
                    <select 
                      value={holidays[dateStr] ? 'holiday' : ''}
                      onChange={(e) => updateHoliday(dateStr, e.target.value === 'holiday')}
                      className="w-full h-full bg-transparent outline-none text-center font-bold cursor-pointer text-[10px] text-red-500"
                    >
                      <option value="">-</option>
                      <option value="holiday" className="font-bold">休日</option>
                    </select>
                  </th>
                );
              })}
              <th className="p-1 border-r border-b border-border-light bg-slate-50 text-center font-bold text-[10px] text-slate-400 w-11 min-w-[44px] max-w-[44px]">
                {dates.filter(d => holidays[formatDate(d)]).length > 0 ? `${dates.filter(d => holidays[formatDate(d)]).length}` : '-'}
              </th>
            </tr>
            {/* Date Row */}
            <tr>
              <th className="sticky left-0 z-40 bg-[#F8FAFC] w-32 p-3 border-r border-b border-border-light font-black text-sub-navy shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                担当者
              </th>
              {dates.map(date => {
                const dateStr = formatDate(date);
                const isToday = dateStr === todayStr;
                const hasMemo = !!memos[dateStr];
                const isHoliday = holidays[dateStr];
                return (
                  <th 
                    key={dateStr}
                    onClick={() => setSelectedDate(dateStr)}
                    className={cn(
                      "px-0.5 py-1.5 border-r border-b border-border-light text-center cursor-pointer hover:bg-slate-100 transition-colors group relative select-none",
                      isToday && "bg-[#FFF7ED] border-x-2 border-x-main-orange",
                      selectedDate === dateStr && !isToday && "bg-slate-50"
                    )}
                  >
                    <div className="flex flex-col items-center justify-center w-full text-center">
                      <div className={cn(
                        "text-[11px] font-bold text-[#334155] tabular-nums tracking-tight text-center leading-tight flex items-center justify-center w-full font-sans",
                        isHoliday && "text-red-500 font-bold opacity-100"
                      )}>
                        {date.getMonth() + 1}/{date.getDate()}
                      </div>
                      <div className={cn(
                        "text-[10px] font-medium text-slate-500 text-center leading-tight mt-0.5 flex items-center justify-center w-full",
                        isHoliday && "text-red-500"
                      )}>
                        {getDayName(date)}
                      </div>
                    </div>
                    {hasMemo && (
                      <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-main-orange rounded-full shadow-sm" />
                    )}
                  </th>
                );
              })}
              {/* ●/20の隣に「休日日数」欄（幅を従来の半分のw-11に調整、文字切れなし） */}
              <th className="p-1 border-r border-b border-border-light text-center bg-[#F1F5F9] font-black text-sub-navy text-[10px] w-11 min-w-[44px] max-w-[44px] leading-tight select-none">
                休日<br />日数
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {staff.map(person => (
              <MonthlyViewRow 
                key={person.id}
                person={person}
                periodDates={dates}
                shifts={shifts}
                holidays={holidays}
                compensatoryDates={compensatoryDates}
                isEditMode={isEditMode}
                shiftAbbreviations={shiftAbbreviations}
                updateShift={updateShift}
                onCellClick={onCellClick}
                formatDate={formatDate}
                getDisplayShiftCode={getDisplayShiftCode}
                getShiftBadgeStyle={getShiftBadgeStyle}
                selectedDate={selectedDate}
                todayStr={todayStr}
                lockedShifts={lockedShifts}
                updateShiftLock={updateShiftLock}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// --- Main App ---

export default function App() {
  // --- Auth State ---


  // --- UI State ---
  const [view, setView] = useState<'monthly' | 'individual' | 'daily_all' | 'settings'>('monthly');
  const [baseDate, setBaseDate] = useState(new Date());
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [isEditMode, setIsEditMode] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const shiftsEditedRef = React.useRef(false);
  const [authModal, setAuthModal] = useState<{ isOpen: boolean, target: 'edit' | 'settings' | null }>({ isOpen: false, target: null });
  const [isPatternDropdownOpen, setIsPatternDropdownOpen] = useState(false);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [memoModal, setMemoModal] = useState<{ isOpen: boolean, date: string }>({ isOpen: false, date: '' });
  const [compensatoryDates, setCompensatoryDates] = useState<CompensatoryData>(() => ({
    '2026-08-03': { '2': '2026-08-01' },
    '2026-08-05': { '3': '2026-08-02' }
  }));
  const [activeTab, setActiveTab] = useState<'staff' | 'shifts' | 'tasks' | 'patterns' | 'task_patterns' | 'app_download'>('staff');
  const [newItem, setNewItem] = useState('');
  const [taskPatterns, setTaskPatterns] = useState<Record<string, TaskPattern>>({});
  const [customDialog, setCustomDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    type: 'confirm' | 'alert';
  } | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void | Promise<void>) => {
    setCustomDialog({
      isOpen: true,
      title,
      message,
      onConfirm,
      type: 'confirm'
    });
  }, []);

  const showAlert = useCallback((title: string, message: string, onConfirm?: () => void) => {
    setCustomDialog({
      isOpen: true,
      title,
      message,
      onConfirm: onConfirm || (() => {}),
      type: 'alert'
    });
  }, []);

  const showToast = useCallback((message: string) => {
    setToast({ message, type: 'success' });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  }, []);

  const [reflectRange, setReflectRange] = useState({ start: '', end: '' });
  const [activeTaskPopup, setActiveTaskPopup] = useState<{ time: string, type: 'plan' | 'result' } | null>(null);
  const [taskMemoModal, setTaskMemoModal] = useState<{
    isOpen: boolean;
    date: string;
    staffId: string;
    time: string;
    type: 'plan' | 'result';
    taskName: string;
    initialMemo: string;
  }>({
    isOpen: false,
    date: '',
    staffId: '',
    time: '',
    type: 'plan',
    taskName: '',
    initialMemo: ''
  });

  // --- Data State (Synced from Firestore, cached in IndexedDB) ---
  const [staff, setStaff] = useState<Staff[]>(() => INITIAL_STAFF);
  const [shiftAbbreviations, setShiftAbbreviations] = useState<ShiftCode[]>(INITIAL_SHIFTS);
  const [taskAbbreviations, setTaskAbbreviations] = useState<TaskCode[]>(INITIAL_TASKS);
  const [shifts, setShifts] = useState<ShiftData>({});
  const [tasks, setTasks] = useState<TaskData>({});
  const [memos, setMemos] = useState<MemoData>({});
  const [staffNoteData, setStaffNoteData] = useState<StaffNoteData>({});
  const [detailedMemoData, setDetailedMemoData] = useState<DetailedMemoData>({});
  const [shiftPattern, setShiftPattern] = useState<ShiftPattern>({});
  const [holidays, setHolidays] = useState<HolidayData>({});
  const [lockedShifts, setLockedShifts] = useState<Record<string, Record<string, boolean>>>({});

  // --- Firestore Subscriptions (Global) ---
  useEffect(() => {
    // 1. Staff
    const unsubStaff = onSnapshot(collection(db, 'staff'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data() as Staff & { order?: number });
      data.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (data.length || !snapshot.metadata.fromCache) setStaff(data.length ? data : INITIAL_STAFF);
    });

    // 2. Config (Abbr, Patterns)
    const unsubConfig = onSnapshot(doc(db, 'config', 'main'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.shiftAbbreviations) setShiftAbbreviations(data.shiftAbbreviations);
        if (data.taskAbbreviations) setTaskAbbreviations(data.taskAbbreviations);
        if (data.shiftPattern) setShiftPattern(data.shiftPattern);
        if (data.taskPatterns) setTaskPatterns(data.taskPatterns);
      }
    });

    return () => {
      unsubStaff();
      unsubConfig();
    };
  }, []);

  // --- Handlers ---
  const handlePrint = useCallback(() => {
    setTimeout(() => {
      window.focus();
      window.print();
    }, 50);
  }, []);

  const handleDownloadApp = async (ext: 'htm' | 'html' = 'htm') => {
    setIsDownloading(true);
    let success = false;
    try {
      let html: string;
      if (window.location.protocol === 'file:') {
        const copy = document.documentElement.cloneNode(true) as HTMLElement;
        copy.querySelector('#root')?.replaceChildren();
        html = '<!doctype html>\n' + copy.outerHTML;
      } else {
        const response = await fetch(`${import.meta.env.BASE_URL}kirinji_shift_app.${ext}`);
        if (!response.ok) throw new Error('先に npm run build を実行してダウンロード用HTMLを生成してください。');
        html = await response.text();
        if (new DOMParser().parseFromString(html, 'text/html').querySelector('script[src]')) throw new Error('ダウンロード用HTMLが未生成です。先に npm run build を実行してください。');
      }
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kirinji_shift_app.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      success = true;
    } catch (err: any) {
      console.error(err);
      showAlert('エラー', err.message || 'ダウンロードに失敗しました。');
    } finally {
      setIsDownloading(false);
      if (success) {
        showToast(`スタンドアロン版アプリ (.${ext}) のダウンロードが完了しました！`);
      }
    }
  };

  const handleReset = async () => {
    showConfirm(
      'データの初期化',
      'すべてのデータベースデータを初期化しますか？',
      async () => {
        const batch = writeBatch(db);
        for (const collName of ['staff', 'shifts', 'tasks', 'memos', 'holidays', 'staff_notes', 'detailed_memos']) {
          const snapshot = await getDocs(collection(db, collName));
          snapshot.docs.forEach(d => batch.delete(d.ref));
        }
        batch.delete(doc(db, 'config', 'main'));
        await batch.commit();
        window.location.reload();
      }
    );
  };

  const openSettings = () => setAuthModal({ isOpen: true, target: 'settings' });

  const handleAuthSuccess = useCallback(() => {
    if (authModal.target === 'edit') setIsEditMode(true);
    else if (authModal.target === 'settings') setView('settings');
    setAuthModal({ isOpen: false, target: null });
  }, [authModal.target]);

  const toggleEditMode = useCallback(async () => {
    if (!isEditMode) {
      setAuthModal({ isOpen: true, target: 'edit' });
      return;
    }
    if (isRecalculating) return;
    if (!shiftsEditedRef.current) {
      setIsEditMode(false);
      return;
    }
    setIsRecalculating(true);
    let timeout: ReturnType<typeof setTimeout>;
    try {
      // Reconciliation needs a complete current snapshot, not a partial offline cache.
      await Promise.race([
        waitForPendingWrites(db),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('シフトの送信が完了していません。接続を確認して再度お試しください。')), 15000);
        }),
      ]);
      clearTimeout(timeout!);
      const [staffSnapshot, shiftSnapshot, holidaySnapshot] = await Promise.all([
        getDocsFromServer(collection(db, 'staff')),
        getDocsFromServer(collection(db, 'shifts')),
        getDocsFromServer(collection(db, 'holidays')),
      ]);
      const allStaff = staffSnapshot.empty ? INITIAL_STAFF : staffSnapshot.docs.map(record => record.data() as Staff);
      const allShifts = shiftSnapshot.docs.map(record => ({ ...record.data(), id: record.id }) as ShiftRecord & { id: string });
      const allHolidays: Record<string, boolean> = {};
      holidaySnapshot.docs.forEach(record => {
        const data = record.data();
        allHolidays[data.date] = !!data.isHoliday;
      });
      const { changes, unmatched } = calculateCompensatoryAssignments(allStaff, allShifts, allHolidays);
      // Keep batches below Firestore's 500-write limit; preserve shift metadata with merge.
      for (let offset = 0; offset < changes.length; offset += 450) {
        const batch = writeBatch(db);
        changes.slice(offset, offset + 450).forEach(({ record, sourceDate }) => {
          batch.update(doc(db, 'shifts', record.id), { compensatorySourceDate: sourceDate });
        });
        await batch.commit();
      }
      shiftsEditedRef.current = false;
      setIsEditMode(false);
      if (unmatched.length) {
        const details = unmatched.map(item => `${allStaff.find(person => person.id === item.staffId)?.name || item.staffId}：${item.date}`).join('\n');
        showAlert('振休の自動割当を更新しました', `充当できる休日出勤が不足している振休は未割当になっています。\n${details}`);
      } else {
        showToast('振休の自動割当を更新しました');
      }
    } catch (error) {
      console.error('Compensatory reconciliation failed:', error);
      showAlert('振休の再計算が完了していません', 'シフトの変更内容は保持しています。インターネット接続とFirebaseのアクセス権を確認し、編集モード解除をもう一度押してください。');
    } finally {
      clearTimeout(timeout!);
      setIsRecalculating(false);
    }
  }, [isEditMode, isRecalculating, showAlert, showToast]);

  const updateShift = useCallback(async (date: string, staffId: string, code: string) => {
    if (isRecalculating || shifts[date]?.[staffId] === code) return;
    shiftsEditedRef.current = true;
    const ref = doc(db, 'shifts', `${date}_${staffId}`);
    try {
      if (!code) await deleteDoc(ref);
      else await setDoc(ref, {
        date, staffId, code,
        shiftType: code === '振休' ? '振休' : '',
        compensatorySourceDate: code === '振休' ? compensatoryDates[date]?.[staffId] || '' : '',
      }, { merge: true });
    } catch (error) {
      console.error('Shift save failed:', error);
      showAlert('シフトの保存に失敗しました', '接続とアクセス権を確認して、シフトを選択し直してください。');
    }
  }, [isRecalculating, shifts, compensatoryDates, showAlert]);

  const updateTask = useCallback(async (date: string, staffId: string, time: string, code: string, type: 'plan' | 'result') => {
    const docId = `${date}_${staffId}_${time}`;
    const currentTask = tasks[date]?.[staffId]?.[time] || { plan: '', result: '' };
    const newData = { ...currentTask, [type]: code };
    
    // Optimistic update
    setTasks(prev => {
      const newTasks = { ...prev };
      if (!newTasks[date]) newTasks[date] = {};
      if (!newTasks[date][staffId]) newTasks[date][staffId] = {};
      newTasks[date][staffId][time] = newData;
      return newTasks;
    });

    if (!newData.plan && !newData.result) {
      await deleteDoc(doc(db, 'tasks', docId));
    } else {
      await setDoc(doc(db, 'tasks', docId), { 
        date, 
        staffId, 
        time, 
        plan: newData.plan, 
        result: newData.result 
      });
    }
  }, [tasks]);

  const updateDetailedMemo = useCallback(async (date: string, staffId: string, text: string) => {
    const docId = `${date}_${staffId}`;
    if (!text.trim()) await deleteDoc(doc(db, 'detailed_memos', docId));
    else await setDoc(doc(db, 'detailed_memos', docId), { date, staffId, text });
  }, []);

  const handleSaveTaskMemo = useCallback(async (memoText: string) => {
    const { date, staffId, time, type, taskName } = taskMemoModal;
    const finalCode = memoText.trim() ? `${taskName}:${memoText.trim()}` : taskName;
    await updateTask(date, staffId, time, finalCode, type);
    setTaskMemoModal(prev => ({ ...prev, isOpen: false }));
  }, [taskMemoModal, updateTask]);

  const exportTasks = useCallback(() => {
    if (!selectedStaffId || !selectedDate) return;
    const person = staff.find(p => p.id === selectedStaffId);
    const dayTasks = tasks[selectedDate]?.[selectedStaffId] || {};
    const dayMemo = memos[selectedDate] || '';
    
    let content = `当日予定：${dayMemo}\n`;
    content += `当日ショップ売上：\n\n`;
    
    TIMES.forEach(time => {
      const task = dayTasks[time]?.result || '';
      if (task) {
        let displayTask = task;
        if (task.startsWith('その他作業:') || task.startsWith('その他作業：')) {
          const colonIdx = task.indexOf(':') !== -1 ? task.indexOf(':') : task.indexOf('：');
          const memo = task.substring(colonIdx + 1);
          displayTask = `その他作業：${memo}`;
        } else if (task.startsWith('資料作成:') || task.startsWith('資料作成：')) {
          const colonIdx = task.indexOf(':') !== -1 ? task.indexOf(':') : task.indexOf('：');
          const memo = task.substring(colonIdx + 1);
          displayTask = `資料作成：${memo}`;
        }
        content += `${time} ${displayTask}\n`;
      }
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedDate}_${person?.name || 'staff'}_実績.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }, [selectedStaffId, selectedDate, staff, tasks, memos]);

  const saveMemo = useCallback(async (val: string) => {
    const date = memoModal.date;
    if (!val.trim()) await deleteDoc(doc(db, 'memos', date));
    else await setDoc(doc(db, 'memos', date), { date, text: val });
    setMemoModal({ isOpen: false, date: '' });
  }, [memoModal.date]);

  const updateStaffNote = useCallback(async (date: string, staffId: string, text: string) => {
    const docId = `${date}_${staffId}`;
    if (!text.trim()) await deleteDoc(doc(db, 'staff_notes', docId));
    else await setDoc(doc(db, 'staff_notes', docId), { date, staffId, text });
  }, []);

  const updateHoliday = useCallback(async (date: string, isHoliday: boolean) => {
    if (isRecalculating) return;
    shiftsEditedRef.current = true;
    try {
      if (isHoliday) await setDoc(doc(db, 'holidays', date), { date, isHoliday: true });
      else await deleteDoc(doc(db, 'holidays', date));
    } catch (error) {
      console.error('Holiday save failed:', error);
      showAlert('休日設定の保存に失敗しました', '接続とアクセス権を確認して、休日設定をやり直してください。');
    }
  }, [isRecalculating, showAlert]);

  const updateShiftLock = useCallback(async (date: string, staffId: string, isLocked: boolean) => {
    const docId = `${date}_${staffId}`;
    await setDoc(doc(db, 'shifts', docId), { locked: isLocked }, { merge: true });
  }, []);

  const copyPreviousRegisteredTasks = async () => {
    if (!selectedStaffId || !selectedDate) return;

    // Find the most recent date before selectedDate that has tasks
    const allTaskDates = Object.keys(tasks).filter(d => d < selectedDate).sort((a, b) => b.localeCompare(a));
    let recentDateWithTasks = '';
    
    for (const d of allTaskDates) {
      const dayStaffTasks = tasks[d]?.[selectedStaffId];
      if (dayStaffTasks && Object.values(dayStaffTasks).some((t: any) => t.plan)) {
        recentDateWithTasks = d;
        break;
      }
    }

    if (!recentDateWithTasks) {
      showAlert('エラー', '以前の登録データが見つかりません');
      return;
    }

    showConfirm(
      '計画データのコピー',
      `${recentDateWithTasks} の「計画」を現在の日にコピーして上書きしますか？`,
      async () => {
        const sourceTasks = tasks[recentDateWithTasks][selectedStaffId];
        const batch = writeBatch(db);
        Object.entries(sourceTasks).forEach(([time, tData]: [string, any]) => {
          if (tData.plan) {
            const docId = `${selectedDate}_${selectedStaffId}_${time}`;
            const currentTask = tasks[selectedDate]?.[selectedStaffId]?.[time] || { plan: '', result: '' };
            batch.set(doc(db, 'tasks', docId), { 
              date: selectedDate, 
              staffId: selectedStaffId, 
              time, 
              plan: tData.plan,
              result: currentTask.result
            });
          }
        });
        await batch.commit();
        showToast(`${recentDateWithTasks} の計画データをコピーしました`);
      }
    );
  };

  const applyTaskPattern = useCallback(async (patternId: string) => {
    if (!selectedStaffId || !selectedDate) return;
    const pattern = taskPatterns[patternId];
    if (!pattern) return;

    showConfirm(
      'パターン適用',
      `パターン「${pattern.name}」を作業日「${selectedDate}」の計画に反映しますか？`,
      async () => {
        const batch = writeBatch(db);
        TIMES.forEach(time => {
          const taskCode = pattern.tasks?.[time] || '';
          const docId = `${selectedDate}_${selectedStaffId}_${time}`;
          const currentTask = tasks[selectedDate]?.[selectedStaffId]?.[time] || { plan: '', result: '' };
          
          const newPlan = taskCode;
          const newResult = currentTask.result || '';

          if (newPlan || newResult) {
            batch.set(doc(db, 'tasks', docId), {
              date: selectedDate,
              staffId: selectedStaffId,
              time,
              plan: newPlan,
              result: newResult
            });
          } else {
            batch.delete(doc(db, 'tasks', docId));
          }
        });

        await batch.commit();
        showToast(`パターン「${pattern.name}」を計画に反映しました`);
      }
    );
  }, [selectedStaffId, selectedDate, taskPatterns, tasks, db, showConfirm, showToast]);

  const applyPattern = async () => {
    if (!reflectRange.start || !reflectRange.end) {
      showAlert('エラー', '開始日と終了日を指定してください');
      return;
    }
    
    const start = new Date(reflectRange.start);
    const end = new Date(reflectRange.end);
    
    if (start > end) {
      showAlert('エラー', '開始日は終了日より前である必要があります');
      return;
    }
    
    showConfirm(
      'パターンの反映',
      '指定された期間のシフトに２週間分の曜日別パターンを一括反映しますか？',
      async () => {
        const batch = writeBatch(db);
        let curr = new Date(start);
        
        while (curr <= end) {
          const dateStr = formatDate(curr);
          const dayOfWeek = curr.getDay();
          const weekOffset = getWeekOffset(curr); // 0 or 1
          const patternIndex = dayOfWeek + (weekOffset * 7); // 0-6 for Week 1, 7-13 for Week 2
          
          staff.forEach(person => {
            const isLocked = lockedShifts[dateStr]?.[person.id];
            if (isLocked) return; // ロックされているシフトは上書きしない
            
            const patternCode = shiftPattern[person.id]?.[patternIndex];
            if (patternCode) {
              const docId = `${dateStr}_${person.id}`;
              batch.set(doc(db, 'shifts', docId), { date: dateStr, staffId: person.id, code: patternCode });
            }
          });
          
          curr.setDate(curr.getDate() + 1);
        }
        
        await batch.commit();
        shiftsEditedRef.current = true;
        showToast('パターンを反映しました');
      }
    );
  };

  // --- DND Handlers ---
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      if (activeTab === 'staff') {
        const oldIndex = staff.findIndex(i => i.id === active.id);
        const newIndex = staff.findIndex(i => i.id === over.id);
        const newList = arrayMove(staff, oldIndex, newIndex);
        
        const batch = writeBatch(db);
        newList.forEach((s: Staff, idx: number) => {
          batch.update(doc(db, 'staff', s.id), { order: idx });
        });
        await batch.commit();
      } else if (activeTab === 'shifts') {
        const oldIndex = shiftAbbreviations.indexOf(active.id as string);
        const newIndex = shiftAbbreviations.indexOf(over.id as string);
        const newList = arrayMove(shiftAbbreviations, oldIndex, newIndex);
        await setDoc(doc(db, 'config', 'main'), { shiftAbbreviations: newList }, { merge: true });
      } else if (activeTab === 'tasks') {
        const oldIndex = taskAbbreviations.indexOf(active.id as string);
        const newIndex = taskAbbreviations.indexOf(over.id as string);
        const newList = arrayMove(taskAbbreviations, oldIndex, newIndex);
        await setDoc(doc(db, 'config', 'main'), { taskAbbreviations: newList }, { merge: true });
      }
    }
  };

  // --- Memoized Values ---
  const periodDates = useMemo(() => getPeriodDates(baseDate), [baseDate]);
  const todayStr = formatDate(new Date());

  const { prevDate, nextDate, prevPeriod, nextPeriod } = useMemo(() => {
    if (periodDates.length === 0) {
      const fallback = new Date();
      return {
        prevDate: fallback,
        nextDate: fallback,
        prevPeriod: [],
        nextPeriod: [],
      };
    }
    const firstDate = periodDates[0];
    const lastDate = periodDates[periodDates.length - 1];

    const pD = new Date(firstDate);
    pD.setDate(pD.getDate() - 3);

    const nD = new Date(lastDate);
    nD.setDate(nD.getDate() + 3);

    const prevP = getPeriodDates(pD);
    const nextP = getPeriodDates(nD);

    return {
      prevDate: prevP.length > 0 ? prevP[prevP.length - 1] : pD,
      nextDate: nextP.length > 0 ? nextP[nextP.length - 1] : nD,
      prevPeriod: prevP,
      nextPeriod: nextP,
    };
  }, [periodDates]);

  // --- Firestore Subscriptions (Period Based: 3 Months Coverage) ---
  useEffect(() => {
    if (periodDates.length === 0) return;

    if (prevPeriod.length === 0 || nextPeriod.length === 0) return;

    const start = formatDate(prevPeriod[0]);
    const end = formatDate(nextPeriod[nextPeriod.length - 1]);

    // 2026年8月度起点（2026-08-01〜）からの振休および過不足計算のため、shifts と holidays は2026-08-01以降も取得
    const effectiveStart = start < '2026-08-01' ? start : '2026-08-01';

    const qShift = query(collection(db, 'shifts'), where('date', '>=', effectiveStart), where('date', '<=', end));
    const unsubShifts = onSnapshot(qShift, (snapshot) => {
      const newShifts: ShiftData = {};
      const newLocks: Record<string, Record<string, boolean>> = {};
      const newCompensatory: CompensatoryData = {};
      snapshot.docs.forEach(d => {
        const { date, staffId, code, locked, compensatorySourceDate } = d.data();
        if (!newShifts[date]) newShifts[date] = {};
        newShifts[date][staffId] = code;
        if (locked) {
          if (!newLocks[date]) newLocks[date] = {};
          newLocks[date][staffId] = true;
        }
        if (compensatorySourceDate) {
          if (!newCompensatory[date]) newCompensatory[date] = {};
          newCompensatory[date][staffId] = compensatorySourceDate;
        }
      });
      setShifts(newShifts);
      setLockedShifts(newLocks);
      setCompensatoryDates(newCompensatory);
    });

    const qTask = query(collection(db, 'tasks'), where('date', '>=', start), where('date', '<=', end));
    const unsubTasks = onSnapshot(qTask, (snapshot) => {
      const newTasks: TaskData = {};
      snapshot.docs.forEach(d => {
        const data = d.data();
        const { date, staffId, time } = data;
        if (!newTasks[date]) newTasks[date] = {};
        if (!newTasks[date][staffId]) newTasks[date][staffId] = {};
        if (typeof data.code === 'string') {
          newTasks[date][staffId][time] = { plan: data.code, result: '' };
        } else {
          newTasks[date][staffId][time] = { plan: data.plan || '', result: data.result || '' };
        }
      });
      setTasks(newTasks);
    });

    const qMemo = query(collection(db, 'memos'), where('date', '>=', start), where('date', '<=', end));
    const unsubMemos = onSnapshot(qMemo, (snapshot) => {
      const newMemos: MemoData = {};
      snapshot.docs.forEach(d => {
        const { date, text } = d.data();
        newMemos[date] = text;
      });
      setMemos(newMemos);
    });

    const qHoliday = query(collection(db, 'holidays'), where('date', '>=', effectiveStart), where('date', '<=', end));
    const unsubHolidays = onSnapshot(qHoliday, (snapshot) => {
      const newHolidays: HolidayData = {};
      snapshot.docs.forEach(d => {
        const { date, isHoliday } = d.data();
        newHolidays[date] = !!isHoliday;
      });
      setHolidays(newHolidays);
    });

    const qNotes = query(collection(db, 'staff_notes'), where('date', '>=', start), where('date', '<=', end));
    const unsubNotes = onSnapshot(qNotes, (snapshot) => {
      const newNotes: StaffNoteData = {};
      snapshot.docs.forEach(d => {
        const { date, staffId, text } = d.data();
        if (!newNotes[date]) newNotes[date] = {};
        newNotes[date][staffId] = text;
      });
      setStaffNoteData(newNotes);
    });

    const qDetailed = query(collection(db, 'detailed_memos'), where('date', '>=', start), where('date', '<=', end));
    const unsubDetailed = onSnapshot(qDetailed, (snapshot) => {
      const newMemos: DetailedMemoData = {};
      snapshot.docs.forEach(d => {
        const { date, staffId, text } = d.data();
        if (!newMemos[date]) newMemos[date] = {};
        newMemos[date][staffId] = text;
      });
      setDetailedMemoData(newMemos);
    });

    return () => {
      unsubShifts();
      unsubTasks();
      unsubMemos();
      unsubHolidays();
      unsubNotes();
      unsubDetailed();
    };
  }, [periodDates, prevPeriod, nextPeriod, baseDate]);

  // --- Views ---

  const renderMonthlyView = () => {
    const renderPrintSection = (title: string, dates: Date[]) => {
      if (dates.length === 0) return null;
      return (
        <div className="mb-8 break-inside-avoid shadow-none border-none p-0 text-slate-800 print:mb-1.5">
          <h2 className="text-sm font-black text-slate-800 mb-2 border-b-2 border-slate-300 pb-1 flex items-center justify-between print:text-[10px] print:mb-0.5 print:pb-0.5">
            <span>{title}</span>
            <span className="text-[10px] text-slate-500 font-bold print:text-[8px]">
              ({dates[0].getMonth() + 1}/{dates[0].getDate()} 〜 {dates[dates.length-1].getMonth() + 1}/{dates[dates.length-1].getDate()})
            </span>
          </h2>
          <div className="rounded-lg border border-slate-300 overflow-hidden bg-white print:rounded-sm">
            <table className="w-full border-collapse table-fixed min-w-full">
              <thead className="bg-[#F8FAFC] text-[#64748B]">
                <tr className="print:h-[22px]">
                  <th className="w-20 p-2 border-r border-b border-slate-300 font-black text-slate-700 text-xs text-left bg-[#F1F5F9] print:p-0.5 print:pl-1.5 print:text-[9px] print:w-14">
                    担当者
                  </th>
                  {dates.map(date => {
                    const dateStr = formatDate(date);
                    const isToday = dateStr === todayStr;
                    const isHoliday = holidays[dateStr];
                    return (
                      <th 
                        key={dateStr}
                        className={cn(
                          "p-0.5 border-r border-b border-slate-300 text-center text-[10px] print:p-0.5 print:text-[8px] print:h-[22px] print:leading-none select-none",
                          isToday && "bg-orange-50 font-bold border-l-2 border-r-2 border-l-orange-400 border-r-orange-400",
                          isHoliday && "text-red-500 font-bold"
                        )}
                      >
                        <div className="flex flex-col items-center justify-center text-center w-full">
                          <div className={cn("tabular-nums font-bold text-center", isHoliday && "text-red-500")}>
                            {date.getDate()}
                          </div>
                          <div className={cn("text-[8px] font-medium leading-none print:text-[6px] text-center mt-0.5", isHoliday && "text-red-500")}>
                            {getDayName(date)}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                  <th className="p-0.5 border-r border-b border-slate-300 text-center text-[10px] font-black text-slate-700 bg-[#F1F5F9] print:p-0.5 print:text-[7.5px] print:h-[22px] print:w-8 w-11 min-w-[44px] max-w-[44px] leading-tight select-none">
                    休日<br />日数
                  </th>
                </tr>
              </thead>
              <tbody>
                {staff.map(person => (
                  <MonthlyViewRow 
                    key={person.id}
                    person={person}
                    periodDates={dates}
                    shifts={shifts}
                    holidays={holidays}
                    compensatoryDates={compensatoryDates}
                    isEditMode={false}
                    shiftAbbreviations={shiftAbbreviations}
                    updateShift={() => {}}
                    onCellClick={() => {}}
                    formatDate={formatDate}
                    getDisplayShiftCode={getDisplayShiftCode}
                    getShiftBadgeStyle={getShiftBadgeStyle}
                    selectedDate=""
                    todayStr={todayStr}
                    lockedShifts={lockedShifts}
                    updateShiftLock={updateShiftLock}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    };

    return (
      <>
        <div className="flex flex-col h-full overflow-hidden bg-bg-gray print:hidden">
          {/* Header Controls */}
      <div className="bg-sub-navy px-6 h-16 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-3 text-white">
          <div className="bg-main-orange w-8 h-8 rounded flex items-center justify-center font-black text-lg">K</div>
          <h1 className="text-xl font-black tracking-wider">キリンジ シフト・作業割当</h1>
        </div>
        <div className="flex gap-2 print:hidden">
          <button 
            onClick={handlePrint}
            className="px-4 py-2 rounded-md font-bold bg-white/10 border border-white/30 text-white hover:bg-white/20 transition-all text-sm flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            印刷
          </button>
          <button 
            onClick={() => setView('daily_all')}
            className="px-4 py-2 rounded-md font-bold bg-transparent border border-white/30 text-white hover:bg-white/10 transition-all text-sm"
          >
            日別全体割当
          </button>
          <button 
            onClick={toggleEditMode}
            disabled={isRecalculating}
            className={cn(
              "px-4 py-2 rounded-md font-bold transition-all text-sm border",
              isEditMode 
                ? "bg-main-orange text-white border-main-orange shadow-lg shadow-orange-900/20" 
                : "bg-transparent text-white border-white/30 hover:bg-white/10"
            )}
          >
            {isRecalculating ? '振休を再計算中…' : isEditMode ? '編集モード解除' : 'シフト編集'}
          </button>
          <button 
            onClick={openSettings}
            className="px-4 py-2 rounded-md font-bold bg-main-orange text-white hover:opacity-90 transition-all text-sm"
          >
            設定
          </button>
        </div>
      </div>

      <div className="p-5 flex-1 overflow-hidden flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-black text-sub-navy">
              {periodDates[periodDates.length - 1].getFullYear()}年 {periodDates[periodDates.length - 1].getMonth() + 1}月度 〜 {nextPeriod[nextPeriod.length - 1].getMonth() + 1}月度 (2ヶ月表示)
            </h2>
            <div className="flex items-center bg-white border border-border-light rounded-lg shadow-sm overflow-hidden">
              <button 
                onClick={() => setBaseDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="p-1.5 hover:bg-slate-50 transition-colors border-r border-border-light"
              >
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </button>
              <button 
                onClick={() => setBaseDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="p-1.5 hover:bg-slate-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <button 
              onClick={() => setBaseDate(new Date())}
              className="px-3 py-1.5 bg-white border border-border-light rounded-lg shadow-sm text-xs font-black text-sub-navy hover:bg-slate-50 transition-all flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-main-orange" />
              当日
            </button>
          </div>
          <p className="text-xs text-slate-500 font-bold">※セルをタップすると当日の作業割当が表示されます</p>
        </div>

        {/* Grid Frame (Scroll Container) */}
        <div className="flex-1 overflow-auto relative min-h-0 pr-1">
          <div className="flex flex-col gap-6 pb-6">
            <ShiftGridTable 
              dates={periodDates}
              title={`${periodDates[periodDates.length - 1].getFullYear()}年 ${periodDates[periodDates.length - 1].getMonth() + 1}月度 (${periodDates[0].getMonth() + 1}/${periodDates[0].getDate()} 〜 ${periodDates[periodDates.length - 1].getMonth() + 1}/${periodDates[periodDates.length - 1].getDate()})`}
              isEditMode={isEditMode && !isRecalculating}
              shifts={shifts}
              memos={memos}
              holidays={holidays}
              compensatoryDates={compensatoryDates}
              staff={staff}
              shiftAbbreviations={shiftAbbreviations}
              updateShift={updateShift}
              updateHoliday={updateHoliday}
              onCellClick={(d, s) => {
                setSelectedStaffId(s);
                setSelectedDate(d);
                setView('individual');
              }}
              formatDate={formatDate}
              getDisplayShiftCode={getDisplayShiftCode}
              getShiftBadgeStyle={getShiftBadgeStyle}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              todayStr={todayStr}
              lockedShifts={lockedShifts}
              updateShiftLock={updateShiftLock}
            />

            <ShiftGridTable 
              dates={nextPeriod}
              title={`${nextPeriod[nextPeriod.length - 1].getFullYear()}年 ${nextPeriod[nextPeriod.length - 1].getMonth() + 1}月度 (${nextPeriod[0].getMonth() + 1}/${nextPeriod[0].getDate()} 〜 ${nextPeriod[nextPeriod.length - 1].getMonth() + 1}/${nextPeriod[nextPeriod.length - 1].getDate()})`}
              isEditMode={isEditMode && !isRecalculating}
              shifts={shifts}
              memos={memos}
              holidays={holidays}
              compensatoryDates={compensatoryDates}
              staff={staff}
              shiftAbbreviations={shiftAbbreviations}
              updateShift={updateShift}
              updateHoliday={updateHoliday}
              onCellClick={(d, s) => {
                setSelectedStaffId(s);
                setSelectedDate(d);
                setView('individual');
              }}
              formatDate={formatDate}
              getDisplayShiftCode={getDisplayShiftCode}
              getShiftBadgeStyle={getShiftBadgeStyle}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              todayStr={todayStr}
              lockedShifts={lockedShifts}
              updateShiftLock={updateShiftLock}
            />
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="bg-[#FFFBEB] border-t border-[#FEF3C7] p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-50 h-[120px]"
          >
            <div className="max-w-5xl mx-auto flex items-stretch gap-6 h-full">
              <div className="flex items-center gap-2 font-black text-[#92400E] shrink-0">
                <FileText className="w-5 h-5" />
                <span>{selectedDate.substring(5).replace('-', '/')} メモ</span>
              </div>
              <div className="flex-1 bg-white border border-[#FDE68A] rounded-lg p-3 overflow-y-auto relative group">
                <p className="text-sm text-[#78350F] leading-relaxed font-semibold">
                  {memos[selectedDate] || 'メモはありません。'}
                </p>
                <button 
                  onClick={() => setMemoModal({ isOpen: true, date: selectedDate })}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-amber-50 text-amber-700 opacity-0 group-hover:opacity-100 transition-all hover:bg-amber-100"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>

    {/* Print Only 3-Months Section */}
    <div className="hidden print:flex print:flex-col print:gap-1 p-4 bg-white text-slate-800 font-sans min-w-[1000px] w-full print:p-2 print:min-h-screen print:justify-start">
      <div className="mb-4 text-center border-b pb-2 print:mb-1 print:pb-1">
        <h1 className="text-xl font-black tracking-wider text-slate-900 mb-1 print:text-sm">キリンジ シフト表 (3ヶ月一覧)</h1>
        <p className="text-xs text-slate-500 font-bold print:text-[8px]">出力日: {todayStr}</p>
      </div>
      {renderPrintSection(`${prevDate.getFullYear()}年 ${prevDate.getMonth() + 1}月度 【前月】`, prevPeriod)}
      {renderPrintSection(`${periodDates.length > 0 ? periodDates[periodDates.length - 1].getFullYear() : baseDate.getFullYear()}年 ${periodDates.length > 0 ? periodDates[periodDates.length - 1].getMonth() + 1 : baseDate.getMonth() + 1}月度 【当月】`, periodDates)}
      {renderPrintSection(`${nextDate.getFullYear()}年 ${nextDate.getMonth() + 1}月度 【翌月】`, nextPeriod)}
    </div>
  </>
);
};

  const renderIndividualView = () => {
    const person = staff.find(p => p.id === selectedStaffId);
    if (!person || !selectedDate) return null;

    return (
      <div className="flex flex-col h-full bg-bg-gray overflow-hidden print:bg-white print:h-auto print:overflow-visible print:block">
        <div className="bg-sub-navy px-6 h-16 flex items-center justify-between shadow-md shrink-0 print:hidden">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setView('monthly')}
              className="p-2 rounded-md hover:bg-white/10 transition-all text-white/50 hover:text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="text-white">
              <h2 className="text-lg font-black leading-tight">{person.name}</h2>
              <p className="text-[10px] font-bold opacity-70">
                {selectedDate} ({getDayName(new Date(selectedDate))})
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={handlePrint}
              className="px-4 py-2 rounded-md font-bold bg-white/10 border border-white/30 text-white hover:bg-white/20 transition-all flex items-center gap-2 text-sm shadow-sm cursor-pointer"
            >
              <Printer className="w-4 h-4 text-main-orange" />
              印刷
            </button>
            {/* 作業パターン適用ボタン & プルダウン */}
            <div className="relative">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPatternDropdownOpen(!isPatternDropdownOpen);
                }}
                className="px-4 py-2 rounded-md font-bold bg-white/10 border border-white/30 text-white hover:bg-white/20 transition-all flex items-center gap-2 text-sm shadow-sm"
              >
                <Clock className="w-4 h-4 text-main-orange" />
                パターン適用
              </button>
              {isPatternDropdownOpen && (
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-border-light z-50 py-2.5 overflow-hidden text-slate-800"
                >
                  <div className="px-3.5 pb-2 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    作業パターンを選択
                  </div>
                  <div className="max-h-60 overflow-y-auto pt-1">
                    {Object.keys(taskPatterns).length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-400 font-bold text-center">
                        パターン未登録
                      </div>
                    ) : (
                      (Object.values(taskPatterns) as TaskPattern[]).map(p => (
                        <button 
                          key={p.id}
                          onClick={() => {
                            applyTaskPattern(p.id);
                            setIsPatternDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-main-orange transition-all flex items-center justify-between"
                        >
                          <span>{p.name}</span>
                          <ChevronRight className="w-3.5 h-3.5 opacity-40 text-slate-400" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button 
              onClick={exportTasks}
              className="px-4 py-2 rounded-md font-bold bg-white/10 border border-white/30 text-white hover:bg-white/20 transition-all flex items-center gap-2 text-sm shadow-sm"
            >
              <FileText className="w-4 h-4 text-main-orange" />
              実績出力
            </button>
            <button 
              onClick={copyPreviousRegisteredTasks}
              className="px-4 py-2 rounded-md font-bold bg-white/10 border border-white/30 text-white hover:bg-white/20 transition-all flex items-center gap-2 text-sm shadow-sm"
            >
              <RotateCcw className="w-4 h-4 text-main-orange" />
              計画コピー
            </button>
            <button 
              onClick={openSettings}
              className="px-4 py-2 rounded-md font-bold bg-main-orange text-white hover:opacity-90 transition-all text-sm"
            >
              設定
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 flex gap-6" onClick={() => activeTaskPopup && setActiveTaskPopup(null)}>
          {/* Left Side: Task Board */}
          <div className="flex-1 bg-white rounded-xl shadow-lg border border-border-light flex flex-col min-w-[600px]">
            <div className="bg-sub-navy p-4 text-white flex items-center shrink-0">
              <span className="font-black text-sm flex items-center gap-2 w-20 shrink-0">
                <Clock className="w-4 h-4 text-main-orange" />
                時間
              </span>
              <div className="flex-1 flex gap-4 pr-1">
                <span className="flex-1 font-black text-xs text-center bg-white/10 py-1 rounded">計画</span>
                <span className="flex-1 font-black text-xs text-center bg-white/10 py-1 rounded">実績</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto divide-y divide-border-light">
              {TIMES.map(time => {
                const taskData = tasks[selectedDate]?.[person.id]?.[time] || { plan: '', result: '' };
                const planColor = getTaskColor(taskData.plan);
                const resultColor = getTaskColor(taskData.result);
                
                return (
                  <div key={time} className="flex items-stretch group hover:bg-slate-50 transition-colors h-14">
                    <div className="w-20 p-3 text-center font-mono font-bold text-slate-400 border-r border-border-light text-xs flex flex-col justify-end bg-slate-50/50">
                      {time}
                    </div>
                    <div className="flex-1 flex gap-2 p-1.5 px-4 items-center relative">
                      {/* Plan Column */}
                      <div className="flex-1 h-full relative">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTaskPopup({ time, type: 'plan' });
                          }}
                          className={cn(
                            "w-full h-full p-2 rounded-md border-2 outline-none font-black transition-all text-center cursor-pointer text-xs truncate",
                            planColor,
                            !taskData.plan && "border-slate-100 text-slate-300"
                          )}
                        >
                          {getDisplayTaskName(taskData.plan)}
                        </button>
                        
                        {activeTaskPopup?.time === time && activeTaskPopup?.type === 'plan' && (
                          <TaskSelectorPopup 
                            type="plan"
                            options={taskAbbreviations}
                            onSelect={(abbr) => {
                              if (abbr === 'その他作業' || abbr === 'その他' || abbr === '資料作成' || abbr === '資料') {
                                const currentVal = taskData.plan || '';
                                let initialMemo = '';
                                if (currentVal.includes(':')) initialMemo = currentVal.split(':')[1];
                                else if (currentVal.includes('：')) initialMemo = currentVal.split('：')[1];
                                
                                setTaskMemoModal({
                                  isOpen: true,
                                  date: selectedDate,
                                  staffId: person.id,
                                  time,
                                  type: 'plan',
                                  taskName: abbr,
                                  initialMemo
                                });
                              } else {
                                updateTask(selectedDate, person.id, time, abbr, 'plan');
                              }
                              setActiveTaskPopup(null);
                            }}
                            onClose={() => setActiveTaskPopup(null)}
                          />
                        )}
                      </div>
 
                      <div className="w-px h-6 bg-slate-200" />
 
                      {/* Result Column */}
                      <div className="flex-1 h-full relative">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTaskPopup({ time, type: 'result' });
                          }}
                          className={cn(
                            "w-full h-full p-2 rounded-md border-2 outline-none font-black transition-all text-center cursor-pointer text-xs truncate",
                            resultColor,
                            !taskData.result && "border-slate-100 text-slate-300"
                          )}
                        >
                          {getDisplayTaskName(taskData.result)}
                        </button>
 
                        {activeTaskPopup?.time === time && activeTaskPopup?.type === 'result' && (
                          <TaskSelectorPopup 
                            type="result"
                            options={taskAbbreviations}
                            onSelect={(abbr) => {
                              if (abbr === 'その他作業' || abbr === 'その他' || abbr === '資料作成' || abbr === '資料') {
                                const currentVal = taskData.result || '';
                                let initialMemo = '';
                                if (currentVal.includes(':')) initialMemo = currentVal.split(':')[1];
                                else if (currentVal.includes('：')) initialMemo = currentVal.split('：')[1];
                                
                                setTaskMemoModal({
                                  isOpen: true,
                                  date: selectedDate,
                                  staffId: person.id,
                                  time,
                                  type: 'result',
                                  taskName: abbr,
                                  initialMemo
                                });
                              } else {
                                updateTask(selectedDate, person.id, time, abbr, 'result');
                              }
                              setActiveTaskPopup(null);
                            }}
                            onClose={() => setActiveTaskPopup(null)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Side: Memos */}
          <div className="w-[450px] flex flex-col gap-4 shrink-0 h-full overflow-hidden">
            {/* Box A: Monthly Memo -> Now "当日予定" */}
            <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden shrink-0">
              <div className="bg-[#FFFBEB] p-3 px-4 border-b border-[#FEF3C7] flex items-center justify-between">
                <span className="text-xs font-black text-[#92400E] flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" />
                  当日予定 ({selectedDate})
                </span>
              </div>
              <div className="p-4 max-h-[120px] overflow-y-auto">
                <p className="text-sm text-[#78350F] font-bold leading-relaxed">
                  {memos[selectedDate] || 'メモはありません。'}
                </p>
              </div>
            </div>

            {/* Box B: Staff Daily Memo (Linked) */}
            <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden shrink-0">
              <div className="bg-slate-50 p-3 px-4 border-b border-border-light flex items-center justify-between">
                <span className="text-xs font-black text-slate-600 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  担当者連絡事項 (全体表示と共有)
                </span>
              </div>
              <div className="p-4">
                <BufferedInput 
                  isTextArea
                  value={staffNoteData[selectedDate]?.[person.id] || ''}
                  onSave={(val) => updateStaffNote(selectedDate, person.id, val)}
                  placeholder="全体割当ページと同期されるテキスト..."
                  className="w-full h-[100px] px-4 py-3 rounded-lg border-2 border-slate-100 focus:border-main-orange outline-none font-bold text-sm bg-slate-50/30 resize-none"
                />
              </div>
            </div>

            {/* Box C: Private/Detailed Memo */}
            <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden flex-1 flex flex-col min-h-0">
              <div className="bg-sub-navy p-3 px-4 flex items-center justify-between">
                <span className="text-xs font-black text-white flex items-center gap-2">
                  <Edit3 className="w-3.5 h-3.5 text-main-orange" />
                  個別詳細メモ (この画面のみ)
                </span>
              </div>
              <div className="p-4 flex-1 overflow-hidden">
                <BufferedInput 
                  isTextArea
                  value={detailedMemoData[selectedDate]?.[person.id] || ''}
                  onSave={(val) => updateDetailedMemo(selectedDate, person.id, val)}
                  placeholder="引継ぎ等詳細なメモを入力してください…"
                  className="w-full h-full p-4 rounded-lg border-2 border-slate-100 focus:border-main-orange outline-none resize-none font-bold text-sm bg-slate-50/30 leading-relaxed"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDailyAllView = () => {
    const dateStr = selectedDate || todayStr;
    const dateObj = new Date(dateStr);

    return (
      <div className="flex flex-col h-full bg-white print:p-0 print:h-auto print:overflow-visible print:block">
        <div className="bg-sub-navy px-6 h-16 flex items-center justify-between shadow-md shrink-0 print:hidden">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setView('monthly')}
              className="p-2 rounded-md hover:bg-white/10 transition-all text-white/50 hover:text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <div className="text-white">
              <h2 className="text-lg font-black">日別全体作業割当</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex items-center bg-white/10 border border-white/20 rounded-md overflow-hidden">
                  <button 
                    onClick={() => {
                      const d = new Date(dateStr);
                      d.setDate(d.getDate() - 1);
                      setSelectedDate(formatDate(d));
                    }}
                    className="p-1 hover:bg-white/10 transition-colors"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="px-3 font-bold text-[10px]">
                    {dateStr} ({getDayName(dateObj)})
                  </span>
                  <button 
                    onClick={() => {
                      const d = new Date(dateStr);
                      d.setDate(d.getDate() + 1);
                      setSelectedDate(formatDate(d));
                    }}
                    className="p-1 hover:bg-white/10 transition-colors"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={handlePrint}
              className="px-4 py-2 rounded-md font-bold bg-main-orange text-white hover:opacity-90 shadow-lg shadow-orange-900/20 transition-all flex items-center gap-2 text-sm cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              印刷
            </button>
            <button 
              onClick={openSettings}
              className="px-4 py-2 rounded-md font-bold bg-transparent border border-white/30 text-white hover:bg-white/10 transition-all text-sm"
            >
              設定
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 print:p-0">
          <div className="max-w-[1400px] mx-auto">
            <div className="hidden print:block mb-8 text-center">
              <h1 className="text-3xl font-black text-sub-navy mb-2">日別全体作業割当</h1>
              <p className="text-lg font-bold text-slate-600">{dateStr} ({getDayName(dateObj)})</p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border-light shadow-xl print:shadow-none print:border-slate-300">
              <table className="min-w-[1200px] w-full border-collapse table-fixed">
                <thead>
                  <tr className="bg-sub-navy text-white">
                    <th className="w-24 p-3 border-r border-slate-700 font-black text-center text-xs">担当者</th>
                    {TIMES.map(time => (
                      <th key={time} className="p-1 border-r border-slate-700 text-[9px] font-mono text-right pr-1">
                        {time}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff
                    .filter(person => {
                      const shiftCode = shifts[dateStr]?.[person.id] || '';
                      return !['振休', '所休', '有休'].includes(shiftCode) && !shiftCode.includes('振休');
                    })
                    .map(person => (
                    <React.Fragment key={person.id}>
                      <tr className="border-b border-border-light print:border-slate-300 h-12">
                        <td className="p-2 border-r border-border-light print:border-slate-300 font-black text-sub-navy text-center bg-[#F8FAFC] text-xs">
                          {person.name}
                        </td>
                        {TIMES.map(time => {
                          const taskData = tasks[dateStr]?.[person.id]?.[time];
                          // Daily Whole view Priority: Result if exists, otherwise Plan
                          const taskCode = taskData?.result || taskData?.plan || '';
                          const colorClass = getTaskColor(taskCode);
                          return (
                            <td 
                              key={time} 
                              className={cn(
                                "p-0.5 border-r border-border-light print:border-slate-300 text-center align-middle",
                                colorClass
                              )}
                            >
                              <span className="text-[9px] font-black leading-tight block truncate">
                                {getDisplayTaskName(taskCode)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="border-b border-border-light print:border-slate-300 h-10 bg-white">
                        <td className="p-1 border-r border-border-light print:border-slate-300 font-bold text-[9px] text-slate-400 text-center bg-[#F8FAFC]">
                          連絡事項
                        </td>
                        <td colSpan={TIMES.length} className="p-1 px-3">
                          <BufferedInput 
                            value={staffNoteData[dateStr]?.[person.id] || ''}
                            onSave={(val) => updateStaffNote(dateStr, person.id, val)}
                            placeholder="個人メモ・連絡事項..."
                            className="w-full h-full bg-transparent outline-none text-[10px] font-bold text-slate-600 print:placeholder-transparent"
                          />
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {memos[dateStr] && (
              <div className="mt-8 p-6 bg-[#FFFBEB] rounded-xl border border-[#FDE68A] print:border-slate-300">
                <h3 className="text-sm font-black text-[#92400E] mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  本日のメモ
                </h3>
                <p className="text-sm text-[#78350F] whitespace-pre-wrap leading-relaxed font-semibold">
                  {memos[dateStr]}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSettingsView = () => {
    const addItem = async () => {
      if (!newItem.trim()) return;
      if (activeTab === 'staff') {
        if (staff.some(s => s.name === newItem.trim())) return alert('既に存在します');
        const id = Date.now().toString();
        await setDoc(doc(db, 'staff', id), { id, name: newItem.trim(), order: staff.length });
      } else if (activeTab === 'shifts') {
        if (shiftAbbreviations.includes(newItem.trim())) return alert('既に存在します');
        const newList = [...shiftAbbreviations, newItem.trim()];
        await setDoc(doc(db, 'config', 'main'), { shiftAbbreviations: newList }, { merge: true });
      } else if (activeTab === 'tasks') {
        if (taskAbbreviations.includes(newItem.trim())) return alert('既に存在します');
        const newList = [...taskAbbreviations, newItem.trim()];
        await setDoc(doc(db, 'config', 'main'), { taskAbbreviations: newList }, { merge: true });
      }
      setNewItem('');
    };

    const items: { id: string, name: string }[] = activeTab === 'staff' 
      ? staff.map(s => ({ id: s.id, name: s.name }))
      : activeTab === 'shifts'
        ? shiftAbbreviations.map(s => ({ id: s, name: s }))
        : taskAbbreviations.map(s => ({ id: s, name: s }));

    return (
      <div className="flex flex-col h-full bg-bg-gray">
        <div className="bg-sub-navy px-6 h-16 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setView('monthly')}
              className="p-2 rounded-md hover:bg-white/10 transition-all text-white/50 hover:text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h2 className="text-lg font-black text-white">設定・管理画面</h2>
          </div>
          <button 
            onClick={handleReset}
            className="px-4 py-2 rounded-md font-bold bg-red-500 text-white hover:opacity-90 transition-all flex items-center gap-2 text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            設定を初期化
          </button>
        </div>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Tabs */}
            <div className="flex bg-white p-1 rounded-xl shadow-sm border border-border-light overflow-x-auto select-none scroller-hidden">
              <button 
                onClick={() => setActiveTab('staff')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg font-black transition-all flex items-center justify-center gap-1.5 text-xs md:text-sm whitespace-nowrap min-w-[70px]",
                  activeTab === 'staff' ? "bg-sub-navy text-white shadow" : "text-slate-400 hover:bg-slate-50"
                )}
              >
                <Users className="w-3.5 h-3.5" />
                担当者
              </button>
              <button 
                onClick={() => setActiveTab('shifts')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg font-black transition-all flex items-center justify-center gap-1.5 text-xs md:text-sm whitespace-nowrap min-w-[85px]",
                  activeTab === 'shifts' ? "bg-sub-navy text-white shadow" : "text-slate-400 hover:bg-slate-50"
                )}
              >
                <Calendar className="w-3.5 h-3.5" />
                シフト略称
              </button>
              <button 
                onClick={() => setActiveTab('tasks')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg font-black transition-all flex items-center justify-center gap-1.5 text-xs md:text-sm whitespace-nowrap min-w-[85px]",
                  activeTab === 'tasks' ? "bg-sub-navy text-white shadow" : "text-slate-400 hover:bg-slate-50"
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                作業略称
              </button>
              <button 
                onClick={() => setActiveTab('patterns')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg font-black transition-all flex items-center justify-center gap-1.5 text-xs md:text-sm whitespace-nowrap min-w-[100px]",
                  activeTab === 'patterns' ? "bg-sub-navy text-white shadow" : "text-slate-400 hover:bg-slate-50"
                )}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                シフトパターン
              </button>
              <button 
                onClick={() => setActiveTab('task_patterns')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg font-black transition-all flex items-center justify-center gap-1.5 text-xs md:text-sm whitespace-nowrap min-w-[100px]",
                  activeTab === 'task_patterns' ? "bg-sub-navy text-white shadow animate-fade-in" : "text-slate-400 hover:bg-slate-50"
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                作業パターン
              </button>
              <button 
                onClick={() => setActiveTab('app_download')}
                className={cn(
                  "flex-1 py-1.5 rounded-lg font-black transition-all flex items-center justify-center gap-1.5 text-xs md:text-sm whitespace-nowrap min-w-[100px]",
                  activeTab === 'app_download' ? "bg-sub-navy text-white shadow animate-fade-in" : "text-slate-400 hover:bg-slate-50"
                )}
              >
                <Save className="w-3.5 h-3.5" />
                パソコンに保存
              </button>
            </div>

            {/* List Management */}
            {activeTab !== 'patterns' && activeTab !== 'task_patterns' && activeTab !== 'app_download' ? (
              <div className="bg-white rounded-xl shadow-lg p-6 border border-border-light space-y-6">
                <div className="flex gap-2">
                  <input 
                    type="text"
                    value={newItem}
                    onChange={(e) => setNewItem(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addItem()}
                    placeholder="新しい項目名を入力..."
                    className="flex-1 px-4 py-2.5 rounded-lg border border-border-light focus:border-main-orange outline-none transition-all font-bold text-sm"
                  />
                  <button 
                    onClick={addItem}
                    className="px-6 py-2.5 rounded-lg bg-main-orange text-white font-black hover:opacity-90 shadow-md shadow-orange-200 transition-all flex items-center gap-2 text-sm"
                  >
                    <Plus className="w-5 h-5" />
                    追加
                  </button>
                </div>

                <div className="space-y-2">
                  <DndContext 
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext 
                      items={items.map(i => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {items.map((item) => (
                        <SortableItem 
                          key={item.id} 
                          id={item.id} 
                          name={item.name} 
                          onRemove={() => {
                            showConfirm(
                              '削除の確認',
                              `「${item.name}」を削除してもよろしいですか？`,
                              async () => {
                                if (activeTab === 'staff') {
                                  await deleteDoc(doc(db, 'staff', item.id));
                                } else if (activeTab === 'shifts') {
                                  const newList = shiftAbbreviations.filter(s => s !== item.id);
                                  await setDoc(doc(db, 'config', 'main'), { shiftAbbreviations: newList }, { merge: true });
                                } else if (activeTab === 'tasks') {
                                  const newList = taskAbbreviations.filter(s => s !== item.id);
                                  await setDoc(doc(db, 'config', 'main'), { taskAbbreviations: newList }, { merge: true });
                                }
                              }
                            );
                          }}
                          onEdit={async (newVal) => {
                            if (activeTab === 'staff') {
                              await updateDoc(doc(db, 'staff', item.id), { name: newVal });
                            } else if (activeTab === 'shifts') {
                              const newList = shiftAbbreviations.map(s => s === item.id ? newVal : s);
                              await setDoc(doc(db, 'config', 'main'), { shiftAbbreviations: newList }, { merge: true });
                            } else if (activeTab === 'tasks') {
                              const newList = taskAbbreviations.map(s => s === item.id ? newVal : s);
                              await setDoc(doc(db, 'config', 'main'), { taskAbbreviations: newList }, { merge: true });
                            }
                          }}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </div>
            ) : activeTab === 'patterns' ? (
              <div className="space-y-6">
                {/* Week 1 Pattern Grid */}
                <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden">
                  <div className="bg-sub-navy p-4 text-white font-black text-sm flex justify-between items-center">
                    <span>1週目 (奇数週) の基本シフト登録</span>
                    <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full font-bold">奇数週 (0〜6日目)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-[#64748B] text-[10px] font-bold">
                          <th className="p-2 border-r border-b border-border-light w-24">担当者</th>
                          {['日', '月', '火', '水', '木', '金', '土'].map((day, i) => (
                            <th key={i} className="p-2 border-r border-b border-border-light">{day}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {staff.map(person => (
                          <tr key={person.id} className="border-b border-border-light">
                            <td className="p-2 border-r border-border-light font-black text-sub-navy text-xs bg-slate-50">
                              {person.name}
                            </td>
                            {[0, 1, 2, 3, 4, 5, 6].map(day => (
                              <td key={day} className="p-1 border-r border-border-light">
                                <select 
                                  value={shiftPattern[person.id]?.[day] || ''}
                                  onChange={async (e) => {
                                    const val = e.target.value;
                                    const newPattern = {
                                      ...shiftPattern,
                                      [person.id]: {
                                        ...(shiftPattern[person.id] || {}),
                                        [day]: val
                                      }
                                    };
                                    await setDoc(doc(db, 'config', 'main'), { shiftPattern: newPattern }, { merge: true });
                                  }}
                                  className="w-full bg-transparent outline-none text-center font-black text-xs cursor-pointer"
                                >
                                  <option value="">-</option>
                                  {shiftAbbreviations.map(abbr => (
                                    <option key={abbr} value={abbr}>{abbr}</option>
                                  ))}
                                </select>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Week 2 Pattern Grid */}
                <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden">
                  <div className="bg-sub-navy p-4 text-white font-black text-sm flex justify-between items-center">
                    <span>2週目 (偶数週) の基本シフト登録</span>
                    <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded-full font-bold">偶数週 (7〜13日目)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-[#64748B] text-[10px] font-bold">
                          <th className="p-2 border-r border-b border-border-light w-24">担当者</th>
                          {['日', '月', '火', '水', '木', '金', '土'].map((day, i) => (
                            <th key={i} className="p-2 border-r border-b border-border-light">{day}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {staff.map(person => (
                          <tr key={person.id} className="border-b border-border-light">
                            <td className="p-2 border-r border-border-light font-black text-sub-navy text-xs bg-slate-50">
                              {person.name}
                            </td>
                            {[7, 8, 9, 10, 11, 12, 13].map(day => (
                              <td key={day} className="p-1 border-r border-border-light">
                                <select 
                                  value={shiftPattern[person.id]?.[day] || ''}
                                  onChange={async (e) => {
                                    const val = e.target.value;
                                    const newPattern = {
                                      ...shiftPattern,
                                      [person.id]: {
                                        ...(shiftPattern[person.id] || {}),
                                        [day]: val
                                      }
                                    };
                                    await setDoc(doc(db, 'config', 'main'), { shiftPattern: newPattern }, { merge: true });
                                  }}
                                  className="w-full bg-transparent outline-none text-center font-black text-xs cursor-pointer"
                                >
                                  <option value="">-</option>
                                  {shiftAbbreviations.map(abbr => (
                                    <option key={abbr} value={abbr}>{abbr}</option>
                                  ))}
                                </select>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pattern Reflection */}
                <div className="bg-white rounded-xl shadow-lg border border-border-light p-6 space-y-4">
                  <h3 className="font-black text-sub-navy text-sm flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-main-orange" />
                    パターンを一括反映
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400">開始日</label>
                      <input 
                        type="date" 
                        value={reflectRange.start}
                        onChange={(e) => setReflectRange(prev => ({ ...prev, start: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-border-light outline-none focus:border-main-orange font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400">終了日</label>
                      <input 
                        type="date" 
                        value={reflectRange.end}
                        onChange={(e) => setReflectRange(prev => ({ ...prev, end: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-border-light outline-none focus:border-main-orange font-bold text-sm"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={applyPattern}
                    className="w-full py-3 rounded-lg bg-main-orange text-white font-black hover:opacity-90 shadow-lg shadow-orange-200 transition-all flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-5 h-5" />
                    上記期間に２週間分パターンを反映する
                  </button>
                  <p className="text-[10px] text-slate-400 font-bold text-center leading-relaxed">
                    ※指定した期間のシフトが、登録した２週間周期の曜日別基本パターンで上書きされます。<br />
                    【1週目】は2025/12/28の週、【2週目】は2026/1/4の週から隔週で交互に適用されます。
                  </p>
                </div>
              </div>
            ) : activeTab === 'task_patterns' ? (
              <div className="space-y-6">
                {/* 1. Add new Pattern Section */}
                <div className="bg-white rounded-xl shadow-lg p-6 border border-border-light space-y-4">
                  <h3 className="font-black text-sub-navy text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4 text-main-orange" />
                    個人作業割当パターンの新規登録
                  </h3>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      id="newTaskPatternNameInput"
                      placeholder="パターン名を入力 (例: 平日朝、土曜夜...)"
                      className="flex-1 px-4 py-2.5 rounded-lg border border-border-light focus:border-main-orange outline-none transition-all font-bold text-sm"
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const target = e.currentTarget;
                          const name = target.value.trim();
                          if (name) {
                            const id = 'task_pattern_' + Date.now();
                            const newPattern = {
                              id,
                              name,
                              tasks: {}
                            };
                            const updated = { ...taskPatterns, [id]: newPattern };
                            await setDoc(doc(db, 'config', 'main'), { taskPatterns: updated }, { merge: true });
                            setSelectedPatternId(id);
                            target.value = '';
                          }
                        }
                      }}
                    />
                    <button 
                      onClick={async () => {
                        const inputEl = document.getElementById('newTaskPatternNameInput') as HTMLInputElement;
                        const name = inputEl?.value.trim();
                        if (!name) return alert('パターン名を入力してください');
                        const id = 'task_pattern_' + Date.now();
                        const newPattern = {
                          id,
                          name,
                          tasks: {}
                        };
                        const updated = { ...taskPatterns, [id]: newPattern };
                        await setDoc(doc(db, 'config', 'main'), { taskPatterns: updated }, { merge: true });
                        setSelectedPatternId(id);
                        if (inputEl) inputEl.value = '';
                      }}
                      className="px-6 py-2.5 rounded-lg bg-main-orange text-white font-black hover:opacity-90 shadow-md shadow-orange-200 transition-all flex items-center gap-2 text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      追加
                    </button>
                  </div>
                </div>

                {/* 2. List of current patterns & detail editor */}
                {Object.keys(taskPatterns).length === 0 ? (
                  <div className="bg-white rounded-xl shadow-lg border border-border-light p-8 text-center text-slate-400 font-bold text-sm">
                    登録されている作業パターンはありません。
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    {/* Pattern selection list */}
                    <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden">
                      <div className="bg-sub-navy p-4 text-white font-black text-sm flex items-center justify-between">
                        <span>パターン一覧</span>
                        <span className="text-xs opacity-75">{Object.keys(taskPatterns).length} 件</span>
                      </div>
                      <div className="divide-y divide-border-light max-h-[400px] overflow-y-auto">
                        {(Object.values(taskPatterns) as TaskPattern[]).map(p => {
                          const list = Object.values(taskPatterns) as TaskPattern[];
                          const isSelected = selectedPatternId === p.id || (!selectedPatternId && list[0]?.id === p.id);
                          return (
                            <div 
                              key={p.id}
                              onClick={() => setSelectedPatternId(p.id)}
                              className={cn(
                                "p-3.5 flex items-center justify-between cursor-pointer transition-colors group",
                                isSelected ? "bg-orange-50/50 hover:bg-orange-50" : "hover:bg-slate-50"
                              )}
                            >
                              <div className="flex-1 min-w-0 pr-4">
                                <span className={cn("text-sm font-black truncate block", isSelected ? "text-main-orange" : "text-sub-navy")}>
                                  {p.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const newName = prompt('新しいパターン名を入力してください', p.name);
                                    if (newName && newName.trim() && newName.trim() !== p.name) {
                                      const updated = {
                                        ...taskPatterns,
                                        [p.id]: {
                                          ...p,
                                          name: newName.trim()
                                        }
                                      };
                                      await setDoc(doc(db, 'config', 'main'), { taskPatterns: updated }, { merge: true });
                                    }
                                  }}
                                  className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                                  title="名前を変更"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    showConfirm(
                                      'パターンの削除',
                                      `パターン「${p.name}」を削除してもよろしいですか？`,
                                      async () => {
                                        const updated = { ...taskPatterns };
                                        delete updated[p.id];
                                        await setDoc(doc(db, 'config', 'main'), { taskPatterns: updated }, { merge: true });
                                        if (selectedPatternId === p.id) {
                                          setSelectedPatternId(null);
                                        }
                                      }
                                    );
                                  }}
                                  className="p-1 text-red-400 hover:text-red-600 rounded transition-colors"
                                  title="削除"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Detail settings grid of selected pattern */}
                    {(() => {
                      const list = Object.values(taskPatterns) as TaskPattern[];
                      const activeId = selectedPatternId || list[0]?.id;
                      const activePattern = taskPatterns[activeId];
                      if (!activePattern) return null;

                      return (
                        <div className="bg-white rounded-xl shadow-lg border border-border-light overflow-hidden flex flex-col">
                          <div className="bg-sub-navy p-4 text-white font-black text-sm border-b border-white/10">
                            「{activePattern.name}」の作業時間割
                          </div>
                          
                          <div className="p-4 grid grid-cols-2 gap-y-3 gap-x-4 max-h-[500px] overflow-y-auto">
                            {TIMES.map(time => {
                              const currentTaskCode = activePattern.tasks?.[time] || '';
                              return (
                                <div key={time} className="flex items-center justify-between gap-2 bg-slate-50 border border-border-light p-2 rounded-lg">
                                  <span className="font-mono text-xs font-bold text-slate-400 shrink-0 w-12 text-center">{time}</span>
                                  <select
                                    value={currentTaskCode}
                                    onChange={async (e) => {
                                      const val = e.target.value;
                                      const updated = {
                                        ...taskPatterns,
                                        [activeId]: {
                                          ...activePattern,
                                          tasks: {
                                            ...(activePattern.tasks || {}),
                                            [time]: val
                                          }
                                        }
                                      };
                                      await setDoc(doc(db, 'config', 'main'), { taskPatterns: updated }, { merge: true });
                                    }}
                                    className="flex-1 bg-transparent text-right outline-none text-xs font-black text-slate-700 cursor-pointer w-full text-ellipsis animate-fade-in"
                                  >
                                    <option value="">-</option>
                                    {taskAbbreviations.map(abbr => {
                                      return (
                                        <option key={abbr} value={abbr}>
                                          {abbr}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                          <div className="p-3 bg-slate-50 border-t border-border-light text-[10px] text-slate-400 font-bold text-center">
                            ※値を選択するとリアルタイムに自動保存されます。
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              // activeTab === 'app_download'
              <div className="bg-white rounded-xl shadow-lg p-8 border border-border-light space-y-6">
                <div className="border-b border-border-light pb-4">
                  <h3 className="text-xl font-black text-sub-navy flex items-center gap-2">
                    <Save className="w-6 h-6 text-main-orange" />
                    このアプリをパソコン（ローカル）に保存して使う
                  </h3>
                  <p className="text-xs text-slate-400 font-bold mt-1">
                    インターネットが繋がらない環境や、デスクトップからクリック1つでアプリを起動可能にするスタンドアロン版です。
                  </p>
                </div>

                <div className="space-y-4 text-slate-600 text-sm leading-relaxed pb-2">
                  <div className="bg-slate-50 border border-border-light p-4 rounded-xl space-y-2">
                    <h4 className="font-black text-sub-navy text-xs flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-main-orange"></span>
                      スタンドアロン版（ローカル起動版）の特徴
                    </h4>
                    <ul className="list-disc pl-5 text-xs text-slate-500 space-y-1.5 font-bold">
                      <li><strong>単一ファイル形式:</strong> 保存されるのは1つのHTMLファイル（.htm / .html）のみです。解凍などの複雑な手順は一切不要で、ファイルをパソコン上でダブルクリックするだけで瞬間的にアプリが起動します。</li>
                      <li><strong>リアルタイム共有:</strong> インターネットに接続すると、同じFirebaseプロジェクトを利用する端末間でシフト・作業割当・設定を共有します。</li>
                      <li><strong>オフライン対応:</strong> このブラウザで取得済みのデータはFirestoreのキャッシュから参照できます。未送信の変更は再接続時に同期します。初回のデータ取得にはインターネット接続が必要です。</li>
                    </ul>
                  </div>

                  <div className="bg-orange-50 border border-orange-100 p-4 rounded-xl space-y-1">
                    <h4 className="font-black text-xs text-main-orange flex items-center gap-1.5">
                      ⚠️ ご利用の注意点
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                      ※同じFirebase接続設定を使用する端末は同じデータを共有します。登録済みのクラウドデータはHTMLファイル自体には含まれません。<br/>
                      ※ダウンロードの際、お使い of ブラウザやセキュリティソフトによって「未確認のファイル」と警告が表示される場合がありますが、本アプリをローカルで起動するために自己完結化したプログラムですので、継続を選択して安全にダウンロードしてください。
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex flex-col gap-4 border-t border-border-light">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button 
                      onClick={() => handleDownloadApp('htm')}
                      disabled={isDownloading}
                      className={cn(
                        "py-4 px-6 rounded-xl bg-main-orange text-white font-black hover:opacity-95 shadow-xl shadow-orange-100 transition-all flex items-center justify-center gap-3 cursor-pointer",
                        isDownloading && "opacity-70 cursor-not-allowed"
                      )}
                    >
                      {isDownloading ? (
                        <div className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Save className="w-5 h-5" />
                      )}
                      {isDownloading ? 'アプリ生成中...' : 'スタンドアロン版 (.htm) をダウンロード'}
                    </button>

                    <button 
                      onClick={() => handleDownloadApp('html')}
                      disabled={isDownloading}
                      className={cn(
                        "py-3 px-6 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition-all flex items-center justify-center gap-3 cursor-pointer text-sm",
                        isDownloading && "opacity-70 cursor-not-allowed"
                      )}
                    >
                      {isDownloading ? (
                        <div className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Save className="w-5 h-5" />
                      )}
                      {isDownloading ? 'アプリ生成中...' : 'スタンドアロン版 (.html) をダウンロード'}
                    </button>
                  </div>
                  
                  <div className="text-center space-y-1.5 pt-1">
                    <p className="text-[10px] text-slate-400 font-bold">
                      ※ダウンロードファイル名: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono">kirinji_shift_app.htm</code> または <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono">kirinji_shift_app.html</code>
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
                      ※社内の共有フォルダなどでご利用される場合、システムや環境のご都合にあわせて拡張子 <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono">.htm</code> をお勧めします（どちらをダウンロードしてもアプリ自体の仕組みと機能は全く同一です）。
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 flex flex-col font-sans text-text-dark bg-bg-gray overflow-hidden print:static print:inset-auto print:h-auto print:w-auto print:overflow-visible print:bg-white print:block">
      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden print:overflow-visible print:h-auto print:block">
        {view === 'monthly' && renderMonthlyView()}
        {view === 'individual' && renderIndividualView()}
        {view === 'daily_all' && renderDailyAllView()}
        {view === 'settings' && renderSettingsView()}
      </div>

      {/* Modals */}
      <PasswordModal 
        isOpen={authModal.isOpen} 
        onClose={() => setAuthModal({ isOpen: false, target: null })}
        onConfirm={handleAuthSuccess}
      />
      <MemoModal 
        isOpen={memoModal.isOpen}
        date={memoModal.date}
        initialValue={memos[memoModal.date] || ''}
        onClose={() => setMemoModal({ isOpen: false, date: '' })}
        onSave={saveMemo}
      />

      {/* その他作業・資料作成用の詳細メモ入力モーダル */}
      <AnimatePresence>
        {taskMemoModal.isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:hidden">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="bg-sub-navy p-4 text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-main-orange" />
                <h3 className="font-bold">{taskMemoModal.time} 【{taskMemoModal.type === 'plan' ? '計画' : '実績'}】{taskMemoModal.taskName}詳細</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs font-bold text-slate-500">
                  作業内容の詳細を入力してください。
                </p>
                <input 
                  type="text"
                  autoFocus
                  defaultValue={taskMemoModal.initialMemo}
                  placeholder={taskMemoModal.taskName?.includes('資料') ? "例：見積書作成" : "例：ミーティング"}
                  className="w-full px-4 py-3 border-2 border-slate-100 focus:border-main-orange outline-none rounded-lg text-slate-800 font-bold"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTaskMemo((e.target as HTMLInputElement).value);
                    if (e.key === 'Escape') setTaskMemoModal(prev => ({ ...prev, isOpen: false }));
                  }}
                  id="taskMemoInput"
                />
                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => setTaskMemoModal(prev => ({ ...prev, isOpen: false }))}
                    className="flex-1 py-3 rounded-lg font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button 
                    onClick={() => {
                      const val = (document.getElementById('taskMemoInput') as HTMLInputElement).value;
                      handleSaveTaskMemo(val);
                    }}
                    className="flex-1 py-3 rounded-lg font-bold bg-main-orange text-white hover:opacity-90 shadow-lg shadow-orange-200 transition-all"
                  >
                    登録
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Dialog Modal */}
      <AnimatePresence>
        {customDialog && customDialog.isOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:hidden">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-border-light"
            >
              <div className="bg-sub-navy p-4 text-white flex items-center gap-2">
                <span className="font-extrabold text-sm">{customDialog.title}</span>
              </div>
              <div className="p-6 space-y-6">
                <p className="text-sm font-bold text-slate-600 leading-relaxed text-center whitespace-pre-wrap">
                  {customDialog.message}
                </p>
                <div className="flex gap-3 justify-center">
                  {customDialog.type === 'confirm' && (
                    <button
                      onClick={() => setCustomDialog(null)}
                      className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs transition-colors"
                    >
                      いいえ
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const onConfirm = customDialog.onConfirm;
                      setCustomDialog(null);
                      if (onConfirm) await onConfirm();
                    }}
                    className="px-5 py-2 rounded-lg bg-main-orange hover:opacity-90 text-white font-extrabold text-xs transition-opacity shadow-lg shadow-orange-100"
                  >
                    {customDialog.type === 'confirm' ? 'はい' : 'OK'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[400] bg-sub-navy text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-2 border border-white/10 font-bold text-xs print:hidden"
          >
            <span className="w-1.5 h-1.5 bg-main-orange rounded-full animate-ping" />
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 4mm 5mm;
          }
          body { 
            background: white !important; 
            overflow: visible !important;
          }
          .fixed { position: static !important; }
          .overflow-hidden { overflow: visible !important; }
          .overflow-auto { overflow: visible !important; }
          .h-full { height: auto !important; }
          
          .print\\:hidden { display: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:border-slate-300 { border-color: #cbd5e1 !important; }
          
          /* 印刷時にテーブルの枠線をはっきりさせる */
          table { 
            width: 100% !important;
            border-collapse: collapse !important; 
            table-layout: fixed !important;
          }
          th, td { 
            border: 1px solid #cbd5e1 !important;
            word-break: break-all !important;
          }
          .sticky { position: static !important; }
          .shadow-\\[2px_0_5px_rgba\\(0\\,0\\,0\\,0\\.05\\)\\] { box-shadow: none !important; }
          
          /* ヘッダーの色を印刷用に調整 */
          thead tr { background-color: #f1f5f9 !important; -webkit-print-color-adjust: exact; }
          .bg-sub-navy { background-color: #1e293b !important; -webkit-print-color-adjust: exact; }
          
          /* メモ欄の調整 */
          .bg-\\[\\#FFFBEB\\] { background-color: #fffbeb !important; -webkit-print-color-adjust: exact; }
        }
        
        /* Custom Scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}
