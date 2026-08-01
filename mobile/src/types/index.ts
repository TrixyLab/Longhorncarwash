export interface User {
  id: string;
  name: string;
  role: string;
  is_approved: boolean;
  is_salary?: boolean;
}

export interface TimeLog {
  id: string;
  user_id: string;
  action: 'IN' | 'OUT' | 'START_LUNCH' | 'END_LUNCH' | 'CLOCK_IN' | 'CLOCK_OUT' | 'TIMESHEET_APPROVED';
  created_at: string;
  edited_by_manager: string | boolean | null;
  punch_lat?: number;
  punch_lon?: number;
  punch_accuracy?: number;
}

export interface ScheduleRow {
  employee: string;
  shifts: string[];
}

export interface Schedule {
  weekRange: string;
  headers: string[];
  rows: ScheduleRow[];
}

export interface Checklist {
  id: string;
  title: string;
  description: string;
  role_required: string;
  tasks: string[];
}

export interface ChecklistCompletion {
  id: string;
  checklist_id: string;
  completed_at: string;
  checklists?: { title: string };
  users?: { name: string };
}

export interface SiteLog {
  id: string;
  type: string;
  description: string;
  equipment_name: string;
  created_at: string;
}

export type ActionType = 'IN' | 'OUT' | 'START_LUNCH' | 'END_LUNCH';
