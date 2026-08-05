import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, Modal, TextInput, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius, font } from '../theme';
import { TimeLog, ActionType } from '../types';
import { notifyManagers } from '../lib/notifications';

const DEFAULT_LAT = 33.06734;
const DEFAULT_LON = -97.29654;
const DEFAULT_RADIUS_M = 100;
// GPS accuracy (how fuzzy the reading is) is independent of the geofence radius.
// Mirror the web app so a tight radius doesn't reject normal indoor phone GPS.
const MAX_GPS_ACCURACY_METERS = 150;
const QUEUE_KEY = '@lcw_punch_queue';
const TZ = 'America/Chicago';
const PUNCH_ACTIONS = ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'];
const MISSED_PUNCH_OPTIONS: { action: ActionType; label: string }[] = [
  { action: 'OUT', label: 'Clock Out' },
  { action: 'IN', label: 'Clock In' },
  { action: 'START_LUNCH', label: 'Start Lunch' },
  { action: 'END_LUNCH', label: 'End Lunch' },
];

// How far back a missed-punch request may reach (mirrors the web validator).
const MISSED_PUNCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type GeofenceConfig = {
  enabled: boolean;
  lat: number;
  lon: number;
  radiusM: number;
};

type WifiLockConfig = {
  enabled: boolean;
  ipAddress: string;
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Whether currentIp matches the configured shop IP (comma/space separated list ok). */
function isWifiIpAllowed(currentIp: string, allowedIps: string): boolean {
  const current = currentIp.trim().toLowerCase();
  if (!current) return false;
  const allowed = allowedIps
    .split(/[\s,;]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(current);
}

function wifiLockFailureReason(cfg: WifiLockConfig, currentIp: string | null, fetchFailed: boolean): string | null {
  if (!cfg.enabled) return null;
  const configured = cfg.ipAddress.trim();
  if (!configured) {
    return 'WiFi lock is enabled but no shop IP is configured. Ask a manager to set it in Settings.';
  }
  if (fetchFailed) {
    return 'Could not verify shop WiFi (network check failed). Stay on shop WiFi and try again.';
  }
  if (!currentIp) {
    return 'Could not verify shop WiFi (no IP returned). Stay on shop WiFi and try again.';
  }
  if (isWifiIpAllowed(currentIp, configured)) return null;
  return 'You must be connected to the shop WiFi to punch the clock.';
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

function formatTime(date: Date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: TZ });
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });
}

function statusLabel(action: TimeLog['action'] | null): string {
  if (!action) return 'NOT CLOCKED IN';
  const labels: Record<TimeLog['action'], string> = {
    IN: 'CLOCKED IN',
    OUT: 'CLOCKED OUT',
    START_LUNCH: 'ON LUNCH',
    END_LUNCH: 'BACK FROM LUNCH',
    CLOCK_IN: 'CLOCKED IN',
    CLOCK_OUT: 'CLOCKED OUT',
    TIMESHEET_APPROVED: 'TIMESHEET APPROVED',
  };
  return labels[action];
}

function statusColor(action: TimeLog['action'] | null): string {
  if (!action || action === 'OUT' || action === 'CLOCK_OUT') return colors.textMuted;
  if (action === 'IN' || action === 'END_LUNCH' || action === 'CLOCK_IN') return colors.success;
  if (action === 'START_LUNCH') return colors.warning;
  return colors.textMuted;
}

export function TimeclockScreen() {
  const { user } = useAuth();
  const [now, setNow] = useState(new Date());
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [lastAction, setLastAction] = useState<TimeLog['action'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [geofence, setGeofence] = useState<GeofenceConfig>({
    enabled: true,
    lat: DEFAULT_LAT,
    lon: DEFAULT_LON,
    radiusM: DEFAULT_RADIUS_M,
  });
  const [wifiLock, setWifiLock] = useState<WifiLockConfig>({ enabled: false, ipAddress: '' });

  const [showMissedModal, setShowMissedModal] = useState(false);
  const [missedAction, setMissedAction] = useState<ActionType>('OUT');
  const [missedDate, setMissedDate] = useState<Date>(new Date());
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [missedReason, setMissedReason] = useState('');
  const [submittingMissed, setSubmittingMissed] = useState(false);

  const todayHours = calcHours(logs);

  // Derive clock state from the true most recent punch, not just today's, so a
  // session that crossed midnight (clocked in last night, still not out) keeps
  // Clock Out enabled and Clock In disabled instead of allowing a duplicate IN.
  const isClockedIn =
    lastAction === 'IN' || lastAction === 'END_LUNCH' || lastAction === 'CLOCK_IN';
  const isClockedOut = !lastAction || lastAction === 'OUT' || lastAction === 'CLOCK_OUT';
  const isOnLunch = lastAction === 'START_LUNCH';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadSettings();
    loadLogs();
    flushQueue();
  }, []);

  async function loadSettings() {
    const { data } = await supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'geofence_enabled',
        'geofence_lat',
        'geofence_lon',
        'geofence_radius',
        'wifi_lock_enabled',
        'wifi_ip_address',
      ]);

    const map = new Map((data ?? []).map(row => [row.id as string, row.value as string]));
    const lat = parseFloat(map.get('geofence_lat') ?? '');
    const lon = parseFloat(map.get('geofence_lon') ?? '');
    const radius = parseInt(map.get('geofence_radius') ?? '', 10);

    setGeofence({
      enabled: map.get('geofence_enabled') !== 'false',
      lat: Number.isFinite(lat) ? lat : DEFAULT_LAT,
      lon: Number.isFinite(lon) ? lon : DEFAULT_LON,
      radiusM: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS_M,
    });
    setWifiLock({
      enabled: map.get('wifi_lock_enabled') === 'true',
      ipAddress: (map.get('wifi_ip_address') ?? '').trim(),
    });
  }

  const loadLogs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    // Look back far enough to catch an overnight shift that was never closed.
    const since = new Date(Date.now() - 48 * 3600000).toISOString();
    const { data } = await supabase
      .from('time_logs')
      .select('id, user_id, action, created_at, edited_by_manager, punch_lat, punch_lon, punch_accuracy')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    const rows = (data ?? []) as TimeLog[];
    const todayLogs = rows.filter(
      l => new Date(l.created_at).toLocaleDateString('en-CA', { timeZone: TZ }) === today
    );
    // The true clock state is the last actual punch in the window, which may be
    // from a prior day; ignore non-punch rows like TIMESHEET_APPROVED.
    const lastPunch = [...rows].reverse().find(l => PUNCH_ACTIONS.includes(l.action));
    setLogs(todayLogs);
    setLastAction(lastPunch ? lastPunch.action : null);
    setLoading(false);
  }, [user]);

  async function flushQueue() {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      const queue: Array<{ user_id: string; action: string; created_at: string }> = JSON.parse(raw);
      for (const item of queue) {
        await supabase.from('time_logs').insert(item);
      }
      await AsyncStorage.removeItem(QUEUE_KEY);
    } catch { /* network error, leave queue */ }
  }

  async function checkWifiLock(): Promise<boolean> {
    if (!wifiLock.enabled) return true;
    let currentIp: string | null = null;
    let fetchFailed = false;
    try {
      // api4 forces IPv4 so a shop that saved an IPv4 address isn't blocked by IPv6.
      const res = await fetch('https://api4.ipify.org?format=json');
      if (!res.ok) throw new Error(`ipify HTTP ${res.status}`);
      const data = await res.json();
      currentIp = data?.ip ? String(data.ip) : null;
    } catch {
      fetchFailed = true;
    }
    const reason = wifiLockFailureReason(wifiLock, currentIp, fetchFailed);
    if (!reason) return true;
    Alert.alert('Shop WiFi Required', reason);
    return false;
  }

  async function checkLocation(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
    if (!geofence.enabled) return null;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location Required', 'Please allow location access to clock in/out.');
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const { latitude, longitude, accuracy } = pos.coords;
    const accuracyM = accuracy ?? 0;
    // Decouple GPS accuracy from geofence radius (same fix as the web app).
    const accuracyLimit = Math.max(geofence.radiusM, MAX_GPS_ACCURACY_METERS);
    if (accuracyM > accuracyLimit) {
      Alert.alert(
        'Weak GPS',
        `GPS signal too weak (~${Math.round(accuracyM * 3.28084)} ft). Step outside and try again.`,
      );
      return null;
    }
    const dist = haversine(geofence.lat, geofence.lon, latitude, longitude);
    // Credit the reading's own accuracy margin — allow if the employee could
    // plausibly be within the radius.
    if (dist - accuracyM > geofence.radiusM) {
      Alert.alert('Too Far Away', `You are ${Math.round(dist * 3.28084)} feet from the site.`);
      return null;
    }
    return { lat: latitude, lon: longitude, accuracy: accuracyM };
  }

  async function punch(action: ActionType) {
    if (!user || punching) return;
    setPunching(true);
    try {
      const wifiOk = await checkWifiLock();
      if (!wifiOk) { setPunching(false); return; }

      const location = await checkLocation();
      if (geofence.enabled && location === null) { setPunching(false); return; }

      const payload: Record<string, unknown> = {
        user_id: user.id,
        action,
        created_at: new Date().toISOString(),
      };
      if (location) {
        payload.punch_lat = location.lat;
        payload.punch_lon = location.lon;
        payload.punch_accuracy = location.accuracy;
      }

      const { error } = await supabase.from('time_logs').insert(payload);
      if (error) {
        await AsyncStorage.getItem(QUEUE_KEY).then(async raw => {
          const queue = raw ? JSON.parse(raw) : [];
          queue.push(payload);
          await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        });
      } else {
        let isLate = false;
        if (action === 'IN') {
          try {
            const { data } = await supabase.from('schedules').select('content').neq('status', 'pending').order('created_at', { ascending: false }).limit(1).single();
            if (data && data.content) {
              const schedule = JSON.parse(data.content);
              const myRow = schedule.rows.find((r: any) => r.employee.trim().toLowerCase() === user.name.trim().toLowerCase());
              if (myRow) {
                const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
                const todayIndex = schedule.headers.findIndex((h: string) => h.startsWith(todayStr));
                if (todayIndex !== -1) {
                  const shift = myRow.shifts[todayIndex];
                  if (shift && !/^(off|-)$/i.test(shift.trim())) {
                    const startTimeStr = shift.split('-')[0].trim();
                    const match = startTimeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                    if (match) {
                      let hours = parseInt(match[1]);
                      const mins = parseInt(match[2]);
                      const isPM = match[3].toUpperCase() === 'PM';
                      if (isPM && hours !== 12) hours += 12;
                      if (!isPM && hours === 12) hours = 0;
                      
                      const nowHours = parseInt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }));
                      const nowMins = parseInt(new Date().toLocaleTimeString('en-US', { minute: 'numeric', timeZone: TZ }));
                      
                      if ((nowHours * 60 + nowMins) > (hours * 60 + mins + 5)) {
                        isLate = true;
                      }
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.log('Error checking late status', err);
          }
        }

        const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
        const actionLabels: Record<ActionType, string> = { IN: 'clocked IN', OUT: 'clocked OUT', START_LUNCH: 'started LUNCH', END_LUNCH: 'returned from LUNCH' };
        let msg = `${user.name} ${actionLabels[action]} at ${timeStr}`;
        if (isLate) msg += ' ⚠️ [LATE]';
        await notifyManagers('Punch Alert', msg);
      }
      await loadLogs();
    } catch {
      Alert.alert('Error', 'Could not record punch. Please try again.');
    } finally {
      setPunching(false);
    }
  }

  function openMissedModal() {
    // Default to now; the employee scrolls the picker back to when they forgot.
    setMissedAction('OUT');
    setMissedDate(new Date());
    setMissedReason('');
    setPickerMode(null);
    setShowMissedModal(true);
  }

  function onPickerChange(event: { type: string }, selected?: Date) {
    // Android fires once and dismisses itself; iOS updates live in the inline
    // spinner until the employee taps Done.
    if (Platform.OS === 'android') setPickerMode(null);
    if (event.type === 'dismissed' || !selected) return;
    setMissedDate(prev => {
      const next = new Date(prev);
      if (pickerMode === 'time') {
        next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      } else {
        next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      }
      return next;
    });
  }

  async function submitMissedPunch() {
    if (!user) return;
    const target = new Date(missedDate);
    if (target.getTime() > Date.now() + 60 * 1000) {
      Alert.alert('Invalid time', "The punch time can't be in the future.");
      return;
    }
    if (Date.now() - target.getTime() > MISSED_PUNCH_MAX_AGE_MS) {
      Alert.alert('Too far back', 'Requests are limited to the last 30 days. Ask a manager to add older punches.');
      return;
    }

    setSubmittingMissed(true);
    const { error } = await supabase.from('missed_punch_requests').insert({
      user_id: user.id,
      employee_name: user.name,
      action: missedAction,
      punch_at: target.toISOString(),
      reason: missedReason.trim() || null,
      status: 'pending',
    });
    setSubmittingMissed(false);
    if (error) {
      Alert.alert('Error', 'Could not send request. Please try again.');
      return;
    }

    const label = MISSED_PUNCH_OPTIONS.find(o => o.action === missedAction)?.label ?? missedAction;
    const timeStr = target.toLocaleString('en-US', {
      weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ,
    });
    await notifyManagers('Missed-Punch Request', `${user.name} requests a ${label} at ${timeStr}`);

    setMissedReason('');
    setShowMissedModal(false);
    Alert.alert('Request sent', 'A manager will review your missed-punch request.');
  }

  const buttons = [
    { label: 'CLOCK IN', action: 'IN' as ActionType, color: colors.success, disabled: isClockedIn || isOnLunch },
    { label: 'CLOCK OUT', action: 'OUT' as ActionType, color: colors.danger, disabled: isClockedOut },
    { label: 'START LUNCH', action: 'START_LUNCH' as ActionType, color: colors.lunch, disabled: !isClockedIn },
    { label: 'END LUNCH', action: 'END_LUNCH' as ActionType, color: colors.success, disabled: !isOnLunch },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Clock */}
        <View style={styles.clockCard}>
          <Text style={styles.clockTime}>{formatTime(now)}</Text>
          <Text style={styles.clockDate}>{formatDate(now)}</Text>
        </View>

        {/* Status */}
        <View style={styles.statusCard}>
          <Text style={styles.greeting}>Hello, {user?.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(lastAction) + '22' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(lastAction) }]} />
            <Text style={[styles.statusText, { color: statusColor(lastAction) }]}>
              {statusLabel(lastAction)}
            </Text>
          </View>
          {todayHours > 0 && (
            <Text style={styles.hoursText}>{todayHours.toFixed(2)} hrs today</Text>
          )}
        </View>

        {/* Punch buttons - hidden for salary employees */}
        {user?.is_salary ? (
          <View style={styles.salaryCard}>
            <Text style={styles.salaryText}>Salaried employees do not clock in.</Text>
          </View>
        ) : loading ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xl }} />
        ) : (
          <View style={styles.buttonGrid}>
            {buttons.map(btn => (
              <TouchableOpacity
                key={btn.action}
                style={[styles.punchBtn, { backgroundColor: btn.color + (btn.disabled ? '33' : 'cc') }]}
                onPress={() => punch(btn.action)}
                disabled={btn.disabled || punching}
                activeOpacity={0.8}
              >
                {punching ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={[styles.punchBtnText, btn.disabled && styles.punchBtnDisabled]}>
                    {btn.label}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Missed-punch request entry point */}
        {!user?.is_salary && !loading && (
          <TouchableOpacity
            style={styles.missedLink}
            onPress={openMissedModal}
            activeOpacity={0.7}
          >
            <Text style={styles.missedLinkText}>Forgot to punch? Request a missed punch</Text>
          </TouchableOpacity>
        )}

        {/* Today's log */}
        {logs.length > 0 && (
          <View style={styles.logCard}>
            <Text style={styles.logTitle}>Today's Punches</Text>
            {[...logs].reverse().map(l => (
              <View key={l.id} style={styles.logRow}>
                <Text style={styles.logAction}>{l.action.replace('_', ' ')}</Text>
                <Text style={styles.logTime}>
                  {new Date(l.created_at).toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ,
                  })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Missed-Punch Request Modal */}
      <Modal visible={showMissedModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request a Missed Punch</Text>

            <Text style={styles.inputLabel}>Which punch did you miss?</Text>
            <View style={styles.chipRow}>
              {MISSED_PUNCH_OPTIONS.map(opt => {
                const active = missedAction === opt.action;
                return (
                  <TouchableOpacity
                    key={opt.action}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setMissedAction(opt.action)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.inputLabel}>When should it have been?</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setPickerMode('date')}
                activeOpacity={0.8}
              >
                <Text style={styles.dateBtnText}>
                  {missedDate.toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric',
                  })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setPickerMode('time')}
                activeOpacity={0.8}
              >
                <Text style={styles.dateBtnText}>
                  {missedDate.toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', hour12: true,
                  })}
                </Text>
              </TouchableOpacity>
            </View>

            {pickerMode && (
              <>
                <DateTimePicker
                  value={missedDate}
                  mode={pickerMode}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={new Date()}
                  minimumDate={new Date(Date.now() - MISSED_PUNCH_MAX_AGE_MS)}
                  onChange={onPickerChange}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => setPickerMode(null)}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <Text style={styles.inputLabel}>Reason (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. phone died before I could clock out"
              placeholderTextColor={colors.textMuted}
              value={missedReason}
              onChangeText={setMissedReason}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowMissedModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={submitMissedPunch} disabled={submittingMissed}>
                {submittingMissed ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.submitBtnText}>Send Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  clockCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  clockTime: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 1,
  },
  clockDate: {
    fontSize: font.base,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  greeting: {
    fontSize: font.md,
    color: colors.text,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: font.sm,
    fontWeight: '700',
    letterSpacing: 1,
  },
  hoursText: {
    fontSize: font.sm,
    color: colors.textMuted,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  punchBtn: {
    width: '48%',
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  punchBtnText: {
    color: colors.white,
    fontSize: font.sm,
    fontWeight: '700',
    letterSpacing: 1,
  },
  punchBtnDisabled: {
    opacity: 0.4,
  },
  salaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  salaryText: {
    color: colors.textMuted,
    fontSize: font.base,
    fontStyle: 'italic',
  },
  logCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  logTitle: {
    fontSize: font.base,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logAction: {
    color: colors.textMuted,
    fontSize: font.sm,
    textTransform: 'capitalize',
  },
  logTime: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: '600',
  },
  missedLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  missedLinkText: {
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  modalTitle: {
    fontSize: font.lg,
    fontWeight: '700',
    color: colors.text,
  },
  inputLabel: {
    fontSize: font.sm,
    color: colors.textMuted,
    marginBottom: -spacing.sm,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    fontSize: font.base,
  },
  dateBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  dateBtnText: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: '600',
  },
  pickerDoneBtn: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pickerDoneText: {
    color: colors.primary,
    fontSize: font.base,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '22',
  },
  chipText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.primary,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  submitBtnText: {
    color: colors.white,
    fontWeight: '700',
  },
});
