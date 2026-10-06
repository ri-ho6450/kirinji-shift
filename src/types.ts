export type ShiftCode = string;
export type TaskCode = string;

export interface Staff {
  id: string;
  name: string;
}

export interface AppSettings {
  staff: Staff[];
  shiftAbbreviations: ShiftCode[];
  taskAbbreviations: TaskCode[];
}

export interface ShiftData {
  [date: string]: {
    [staffId: string]: ShiftCode;
  };
}

export interface TaskData {
  [date: string]: {
    [staffId: string]: {
      [time: string]: {
        plan: TaskCode;
        result: TaskCode;
      };
    };
  };
}

export interface MemoData {
  [date: string]: string;
}

export interface StaffNoteData {
  [date: string]: {
    [staffId: string]: string;
  };
}

export interface DetailedMemoData {
  [date: string]: {
    [staffId: string]: string;
  };
}

export interface ShiftPattern {
  [staffId: string]: {
    [dayOfWeek: number]: ShiftCode;
  };
}

export interface HolidayData {
  [date: string]: boolean;
}

export interface CompensatoryData {
  [date: string]: {
    [staffId: string]: string;
  };
}

export interface ShiftRecord {
  date: string;
  staffId: string;
  code: string;
  shiftType?: string;
  compensatorySourceDate?: string;
  locked?: boolean;
}

export interface TaskPattern {
  id: string;
  name: string;
  tasks: {
    [time: string]: string;
  };
}
