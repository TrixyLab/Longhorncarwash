import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Alert, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius, font } from '../../theme';
import { TimeLog, User, ActionType } from '../../types';

const TZ = 'America/Chicago';

function getWeekStart(): string {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const day = ct.getDay();
  const daysFromWed = (day + 7 - 3) % 7;
  const ws = new Date(ct);
  ws.setDate(ct.getDate() - daysFromWed);
  return ws.toLocaleDateString('en-CA');
}

function calcHours(logs: TimeLog[]): number {
  const sorted = [...logs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let total = 0, lastIn: number | null = null;
  for (const l of sorted) {
    const t = new Date(l.created_at).getTime();
    if (l.action === 'IN' || l.action === 'END_LUNCH' || l.action === 'CLOCK_IN') lastIn = t;
    else if (
      (l.action === 'START_LUNCH' || l.action === 'OUT' || l.action === 'CLOCK_OUT') &&
      lastIn !== null
    ) {
      total += (t - lastIn) / 3600000;
      lastIn = null;
    }
  }
  return total;
}

interface EmployeeRow {
  user: User;
  logs: TimeLog[];
  hours: number;
  status: string;
}

export function TimesheetScreen() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [managingLogs, setManagingLogs] = useState(false);
  const [newAction, setNewAction] = useState('IN');
  const [newTime, setNewTime] = useState('');
  const [addingLog, setAddingLog] = useState(false);

  useEffect(() => { loadTimesheet(); }, []);

  const loadTimesheet = useCallback(async () => {
    setLoading(true);
    const weekStart = getWeekStart();
    const since = new Date(weekStart + 'T00:00:00').toISOString();

    const [usersRes, logsRes] = await Promise.all([
      supabase.from('users').select('id, name, role, is_approved').eq('is_approved', true),
      supabase.from('time_logs')
        .select('id, user_id, action, created_at, edited_by_manager')
        .gte('created_at', since)
        .in('action', ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'])
        .order('created_at', { ascending: true }),
    ]);

    const users = (usersRes.data ?? []) as User[];
    const allLogs = (logsRes.data ?? []) as TimeLog[];

    const byUser: Record<string, TimeLog[]> = {};
    for (const l of allLogs) {
      if (!byUser[l.user_id]) byUser[l.user_id] = [];
      byUser[l.user_id].push(l);
    }

    const result: EmployeeRow[] = users.map(u => {
      const userLogs = byUser[u.id] ?? [];
      const hrs = calcHours(userLogs);
      const last = userLogs[userLogs.length - 1]?.action ?? null;
      const status = !last ? 'Out' : last === 'IN' || last === 'END_LUNCH' ? 'Clocked In' :
        last === 'START_LUNCH' ? 'On Lunch' : 'Clocked Out';
      return { user: u, logs: userLogs, hours: hrs, status };
    });

    result.sort((a, b) => b.hours - a.hours);
    setRows(result);
    setLoading(false);
  }, []);

  async function deleteLog(log: TimeLog) {
    Alert.alert('Delete Punch', 'Delete this punch record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const editedBy = log.edited_by_manager != null ? String(log.edited_by_manager) : '';
            const isAutoSweepOut =
              (log.action === 'OUT' || log.action === 'CLOCK_OUT') &&
              editedBy.includes('System Auto-Sweep');

            // Marker first so a concurrent web/server sweep cannot recreate the OUT.
            if (isAutoSweepOut) {
              const sweepDate = new Date(log.created_at);
              const windowStart = new Date(sweepDate.getTime() - 20 * 3600000).toISOString();
              const windowEnd = new Date(sweepDate.getTime() + 20 * 3600000).toISOString();
              const { data: ins, error: inErr } = await supabase
                .from('time_logs')
                .select('created_at')
                .eq('user_id', log.user_id)
                .in('action', ['IN', 'CLOCK_IN', 'END_LUNCH', 'START_LUNCH'])
                .gte('created_at', windowStart)
                .lte('created_at', windowEnd)
                .order('created_at', { ascending: false })
                .limit(1);
              if (inErr) throw inErr;
              const inAt = ins?.[0]?.created_at || log.created_at;
              const { error: markerErr } = await supabase.from('time_logs').insert({
                user_id: log.user_id,
                action: 'AUTO_SWEEP_CLEARED',
                created_at: new Date(new Date(inAt).getTime() + 1000).toISOString(),
                edited_by_manager: 'Manager cleared auto-sweep',
              });
              if (markerErr) throw markerErr;
            }

            const { error: delErr } = await supabase.from('time_logs').delete().eq('id', log.id);
            if (delErr) throw delErr;

            if (selectedEmployee) {
              const updated = {
                ...selectedEmployee,
                logs: selectedEmployee.logs.filter((l: TimeLog) => l.id !== log.id),
              };
              updated.hours = calcHours(updated.logs);
              setSelectedEmployee(updated);
            }
            loadTimesheet();
          } catch (err: any) {
            Alert.alert('Delete failed', err?.message || 'Could not delete this punch. Try again.');
          }
        },
      },
    ]);
  }

  async function addLog() {
    if (!selectedEmployee || !newTime) { Alert.alert('Error', 'Enter a time.'); return; }
    setAddingLog(true);
    const { error } = await supabase.from('time_logs').insert({
      user_id: selectedEmployee.user.id,
      action: newAction,
      created_at: new Date(newTime).toISOString(),
      edited_by_manager: true,
    });
    setAddingLog(false);
    if (error) { Alert.alert('Error', 'Could not add log.'); return; }

    const newLogItem: TimeLog = {
      id: Date.now().toString(),
      user_id: selectedEmployee.user.id,
      action: newAction as any,
      created_at: new Date(newTime).toISOString(),
      edited_by_manager: true,
    };
    const updatedLogs = [...selectedEmployee.logs, newLogItem];
    setSelectedEmployee({ ...selectedEmployee, logs: updatedLogs, hours: calcHours(updatedLogs) });
    setNewTime('');
    loadTimesheet();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xl * 2 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.weekLabel}>Week of {getWeekStart()}</Text>

        {rows.map((row: EmployeeRow) => (
          <TouchableOpacity
            key={row.user.id}
            style={styles.employeeCard}
            onPress={() => { setSelectedEmployee(row); setManagingLogs(true); }}
            activeOpacity={0.8}
          >
            <View style={styles.employeeInfo}>
              <Text style={styles.employeeName}>{row.user.name}</Text>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{row.status}</Text>
              </View>
            </View>
            <Text style={styles.hoursText}>{row.hours.toFixed(2)} hrs</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={managingLogs} animationType="slide" onRequestClose={() => setManagingLogs(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{selectedEmployee?.user.name} - Punch Logs</Text>
            <TouchableOpacity onPress={() => setManagingLogs(false)}>
              <Text style={styles.closeBtn}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text style={styles.addTitle}>Add Manual Punch</Text>
            <View style={styles.actionRow}>
              {(['IN', 'OUT', 'START_LUNCH', 'END_LUNCH'] as ActionType[]).map((a: ActionType) => (
                <TouchableOpacity
                  key={a}
                  style={[styles.actionBtn, newAction === a && styles.actionBtnActive]}
                  onPress={() => setNewAction(a)}
                >
                  <Text style={[styles.actionBtnText, newAction === a && styles.actionBtnTextActive]}>
                    {a.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.timeInput, { color: colors.text }]}
              placeholder="Time (e.g. 2026-07-21 09:00)"
              placeholderTextColor={colors.textMuted}
              value={newTime}
              onChangeText={setNewTime}
            />
            <TouchableOpacity style={styles.addBtn} onPress={addLog} disabled={addingLog}>
              {addingLog ? <ActivityIndicator color={colors.white} /> : <Text style={styles.addBtnText}>Add Punch</Text>}
            </TouchableOpacity>

            <Text style={styles.logsTitle}>Punch Log ({selectedEmployee?.hours.toFixed(2)} hrs)</Text>
            {(selectedEmployee?.logs ?? []).slice().reverse().map((l: TimeLog) => (
              <View key={l.id} style={styles.logRow}>
                <View>
                  <Text style={styles.logAction}>{l.action.replace('_', ' ')}</Text>
                  <Text style={styles.logTime}>
                    {new Date(l.created_at).toLocaleString('en-US', {
                      timeZone: TZ, month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit', hour12: true,
                    })}
                    {l.edited_by_manager ? '  (edited)' : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteLog(l)}>
                  <Text style={styles.deleteBtn}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  weekLabel: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.xs },
  employeeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  employeeInfo: { gap: spacing.xs },
  employeeName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, alignSelf: 'flex-start' },
  statusPillText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  hoursText: { fontSize: font.lg, fontWeight: '700', color: colors.primary },
  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  closeBtn: { color: colors.primary, fontSize: font.base, fontWeight: '600' },
  modalScroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  addSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  actionRow: { flexDirection: 'row', gap: spacing.xs },
  actionBtn: {
    flex: 1, padding: spacing.sm, borderRadius: radius.sm,
    backgroundColor: colors.card, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  actionBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionBtnText: { color: colors.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  actionBtnTextActive: { color: colors.white },
  timeInput: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, fontSize: font.base,
  },
  addBtn: {
    backgroundColor: colors.primary, padding: spacing.md,
    borderRadius: radius.md, alignItems: 'center',
  },
  addBtnText: { color: colors.white, fontWeight: '700' },
  logsTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  logRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logAction: { fontSize: font.base, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
  logTime: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing.xs },
  deleteBtn: { color: colors.danger, fontSize: font.sm, fontWeight: '700' },
});
