import { state, showToast, saveSettingRobust, isPrivateOrLocalIp } from './utils.js';

// Expose a promise that resolves once remote settings have been loaded into
// state, so punch flows can wait for it instead of racing the initial fetch.
let resolveSettingsReady;
state.settingsReady = new Promise((resolve) => {
  resolveSettingsReady = resolve;
});

// --- Announcement ---
const announcementInput = document.getElementById('announcement-input');
const btnPostAnnouncement = document.getElementById('btn-post-announcement');
const btnClearAnnouncement = document.getElementById('btn-clear-announcement');

// --- Geofence ---
const geofenceInput = document.getElementById('geofence-input');
const geofenceLatInput = document.getElementById('geofence-lat');
const geofenceLonInput = document.getElementById('geofence-lon');
const btnSaveGeofence = document.getElementById('btn-save-geofence');
const btnToggleGeofence = document.getElementById('btn-toggle-geofence');
const geofenceStatusText = document.getElementById('geofence-status-text');
const btnGetCurrentLocation = document.getElementById('btn-get-current-location');

// --- Anti-Buddy ---
const btnToggleAntiBuddy = document.getElementById('btn-toggle-anti-buddy');
const antiBuddyStatusText = document.getElementById('anti-buddy-status-text');

// --- Early Clock-In Block ---
const btnToggleEarlyBlock = document.getElementById('btn-toggle-early-block');
const earlyBlockStatusText = document.getElementById('early-block-status-text');

// --- WiFi Lock ---
const wifiLockStatusText = document.getElementById('wifi-lock-status-text');
const btnToggleWifiLock = document.getElementById('btn-toggle-wifi-lock');
const wifiIpInput = document.getElementById('wifi-ip-input');
const btnGetCurrentIp = document.getElementById('btn-get-current-ip');
const btnSaveWifiIp = document.getElementById('btn-save-wifi-ip');

// --- Payroll Format ---
const btnEditPayrollFormat = document.getElementById('btn-edit-payroll-format');
const modalEditPayrollFormat = document.getElementById('modal-edit-payroll-format');
const btnCancelPayrollFormat = document.getElementById('btn-cancel-payroll-format');
const btnSavePayrollFormat = document.getElementById('btn-save-payroll-format');
const customCurrentFormatInput = document.getElementById('custom-current-format');
const customNextFormatInput = document.getElementById('custom-next-format');

// --- Theme ---
const btnThemeDark = document.getElementById('btn-theme-dark');
const btnThemeLight = document.getElementById('btn-theme-light');

// --- Security / 2FA ---
const btnShowSecurity = document.getElementById('btn-show-security');
const modalSecurity = document.getElementById('modal-security');
const enable2FA = document.getElementById('enable-2fa');
const setup2FASection = document.getElementById('setup-2fa-section');
const setup2FAPin = document.getElementById('setup-2fa-pin');
const btnCloseSecurity = document.getElementById('btn-close-security');
const btnSaveSecurity = document.getElementById('btn-save-security');
// --- Commission Rates ---
const commSingleGoodInput = document.getElementById('comm-single-good-input');
const commSingleBetterInput = document.getElementById('comm-single-better-input');
const commSingleBestInput = document.getElementById('comm-single-best-input');
const commMembershipGoodInput = document.getElementById('comm-membership-good-input');
const commMembershipBetterInput = document.getElementById('comm-membership-better-input');
const commMembershipBestInput = document.getElementById('comm-membership-best-input');
const btnSaveCommissions = document.getElementById('btn-save-commissions');

export function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light-mode');
    if (btnThemeLight) {
      btnThemeLight.className = 'btn-action btn-primary';
      btnThemeLight.style.background = 'var(--primary)';
      btnThemeLight.style.color = 'white';
      btnThemeLight.style.borderColor = 'transparent';
      btnThemeLight.style.boxShadow = '0 4px 15px rgba(169, 59, 47, 0.15)';
    }
    if (btnThemeDark) {
      btnThemeDark.className = 'btn-action btn-ghost';
      btnThemeDark.style.background = 'var(--bg)';
      btnThemeDark.style.color = 'var(--text)';
      btnThemeDark.style.borderColor = 'var(--border)';
      btnThemeDark.style.boxShadow = 'none';
    }
  } else {
    document.documentElement.classList.remove('light-mode');
    if (btnThemeDark) {
      btnThemeDark.className = 'btn-action btn-primary';
      btnThemeDark.style.background = 'var(--primary)';
      btnThemeDark.style.color = 'white';
      btnThemeDark.style.borderColor = 'transparent';
      btnThemeDark.style.boxShadow = '0 4px 15px rgba(169, 59, 47, 0.15)';
    }
    if (btnThemeLight) {
      btnThemeLight.className = 'btn-action btn-ghost';
      btnThemeLight.style.background = 'var(--bg)';
      btnThemeLight.style.color = 'var(--text)';
      btnThemeLight.style.borderColor = 'var(--border)';
      btnThemeLight.style.boxShadow = 'none';
    }
  }
}

function updateGeofenceUI() {
  if (!btnToggleGeofence || !geofenceStatusText) return;
  if (state.GEOFENCE_ENABLED) {
    geofenceStatusText.textContent = 'Enabled';
    geofenceStatusText.style.color = 'var(--success)';
    btnToggleGeofence.textContent = 'Disable';
    btnToggleGeofence.className = 'btn-danger';
  } else {
    geofenceStatusText.textContent = 'Disabled';
    geofenceStatusText.style.color = 'var(--text-muted)';
    btnToggleGeofence.textContent = 'Enable';
    btnToggleGeofence.className = 'btn-success';
  }
}

function updateWifiLockUI() {
  if (!btnToggleWifiLock || !wifiLockStatusText) return;
  if (state.WIFI_LOCK_ENABLED) {
    wifiLockStatusText.textContent = 'Enabled';
    wifiLockStatusText.style.color = 'var(--success)';
    btnToggleWifiLock.textContent = 'Disable';
    btnToggleWifiLock.className = 'btn-danger';
  } else {
    wifiLockStatusText.textContent = 'Disabled';
    wifiLockStatusText.style.color = 'var(--text-muted)';
    btnToggleWifiLock.textContent = 'Enable';
    btnToggleWifiLock.className = 'btn-success';
  }
}

function updateAntiBuddyUI() {
  if (!btnToggleAntiBuddy || !antiBuddyStatusText) return;
  if (state.ANTI_BUDDY_ENABLED) {
    antiBuddyStatusText.textContent = 'Enabled';
    antiBuddyStatusText.style.color = 'var(--success)';
    btnToggleAntiBuddy.textContent = 'Disable';
    btnToggleAntiBuddy.className = 'btn-danger';
  } else {
    antiBuddyStatusText.textContent = 'Disabled';
    antiBuddyStatusText.style.color = 'var(--text-muted)';
    btnToggleAntiBuddy.textContent = 'Enable';
    btnToggleAntiBuddy.className = 'btn-success';
  }
}

function updateEarlyBlockUI() {
  if (!btnToggleEarlyBlock || !earlyBlockStatusText) return;
  if (state.EARLY_CLOCKIN_BLOCK_ENABLED) {
    earlyBlockStatusText.textContent = 'Enabled';
    earlyBlockStatusText.style.color = 'var(--success)';
    btnToggleEarlyBlock.textContent = 'Disable';
    btnToggleEarlyBlock.className = 'btn-danger';
  } else {
    earlyBlockStatusText.textContent = 'Disabled';
    earlyBlockStatusText.style.color = 'var(--text-muted)';
    btnToggleEarlyBlock.textContent = 'Enable';
    btnToggleEarlyBlock.className = 'btn-success';
  }
}

async function loadCustomPayrollFormat() {
  try {
    const { data, error } = await window.supabaseClient
      .from('settings')
      .select('value')
      .eq('id', 'custom_payroll_format')
      .limit(1);
    if (!error && data && data.length > 0) {
      state.customPayrollFormat = JSON.parse(data[0].value);
      if (customCurrentFormatInput)
        customCurrentFormatInput.value = state.customPayrollFormat.current || '';
      if (customNextFormatInput) customNextFormatInput.value = state.customPayrollFormat.next || '';
    }
  } catch (e) {
    console.error('Failed to load payroll format:', e);
  }
}

export async function fetchSettings() {
  const db = window.supabaseClient;

  try {
    const { data, error } = await db
      .from('settings')
      .select('value')
      .eq('id', 'announcement')
      .limit(1);
    if (!error && data && data.length > 0) {
      state.activeAnnouncement = data[0].value;
      if (announcementInput) announcementInput.value = data[0].value;
    }
  } catch (e) {
    console.error('Failed to load announcement setting:', e);
  }

  try {
    const { data: geoData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'geofence_radius')
      .limit(1);
    if (geoData && geoData.length > 0) {
      state.ALLOWED_RADIUS_METERS = parseInt(geoData[0].value, 10);
    }
    if (geofenceInput) geofenceInput.value = state.ALLOWED_RADIUS_METERS;

    const { data: latData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'geofence_lat')
      .limit(1);
    if (latData && latData.length > 0) state.CAR_WASH_LAT = parseFloat(latData[0].value);
    if (geofenceLatInput) geofenceLatInput.value = state.CAR_WASH_LAT;

    const { data: lonData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'geofence_lon')
      .limit(1);
    if (lonData && lonData.length > 0) state.CAR_WASH_LON = parseFloat(lonData[0].value);
    if (geofenceLonInput) geofenceLonInput.value = state.CAR_WASH_LON;

    const { data: enabledData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'geofence_enabled')
      .limit(1);
    if (enabledData && enabledData.length > 0) {
      state.GEOFENCE_ENABLED = enabledData[0].value === 'true';
    }
    updateGeofenceUI();

    const { data: abData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'anti_buddy_enabled')
      .limit(1);
    if (abData && abData.length > 0) {
      state.ANTI_BUDDY_ENABLED = abData[0].value === 'true';
    }
    updateAntiBuddyUI();

    // Load WiFi Lock
    const { data: wifiEnabledData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'wifi_lock_enabled')
      .limit(1);
    if (wifiEnabledData && wifiEnabledData.length > 0) {
      state.WIFI_LOCK_ENABLED = wifiEnabledData[0].value === 'true';
    }
    const { data: wifiIpData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'wifi_ip_address')
      .limit(1);
    if (wifiIpData && wifiIpData.length > 0) {
      state.WIFI_IP_ADDRESS = wifiIpData[0].value;
      if (wifiIpInput) wifiIpInput.value = state.WIFI_IP_ADDRESS;
    }
    updateWifiLockUI();

    const { data: ebData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'early_clockin_block_enabled')
      .limit(1);
    if (ebData && ebData.length > 0) {
      state.EARLY_CLOCKIN_BLOCK_ENABLED = ebData[0].value === 'true';
    }
    updateEarlyBlockUI();

    const { data: revData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'daily_revenue_goal')
      .limit(1);
    if (revData && revData.length > 0) {
      state.dailyRevenueGoal = parseFloat(revData[0].value) || 0;
      const dailyRevenueInput = document.getElementById('daily-revenue-input');
      if (dailyRevenueInput) dailyRevenueInput.value = state.dailyRevenueGoal;
    }

    const { data: goalData } = await db
      .from('settings')
      .select('value')
      .eq('id', 'labor_cost_goal_percent')
      .limit(1);
    if (goalData && goalData.length > 0) {
      state.laborCostGoalPercent = parseFloat(goalData[0].value) || 25;
      const laborGoalInput = document.getElementById('labor-goal-input');
      if (laborGoalInput) laborGoalInput.value = state.laborCostGoalPercent;
    }

    const commKeys = [
      'comm_single_good',
      'comm_single_better',
      'comm_single_best',
      'comm_membership_good',
      'comm_membership_better',
      'comm_membership_best'
    ];
    for (const key of commKeys) {
      const { data } = await db.from('settings').select('value').eq('id', key).limit(1);
      if (data && data.length > 0) {
        state[key] = parseFloat(data[0].value) || 0;
      }
    }
    if (commSingleGoodInput) commSingleGoodInput.value = (state.comm_single_good / 100).toFixed(2);
    if (commSingleBetterInput) commSingleBetterInput.value = (state.comm_single_better / 100).toFixed(2);
    if (commSingleBestInput) commSingleBestInput.value = (state.comm_single_best / 100).toFixed(2);
    if (commMembershipGoodInput) commMembershipGoodInput.value = (state.comm_membership_good / 100).toFixed(2);
    if (commMembershipBetterInput) commMembershipBetterInput.value = (state.comm_membership_better / 100).toFixed(2);
    if (commMembershipBestInput) commMembershipBestInput.value = (state.comm_membership_best / 100).toFixed(2);

  } catch (e) {
    console.error('Failed to load geofence/anti-buddy settings:', e);
  }

  // Signal that settings are loaded (even on partial failure — punches should
  // fall back to defaults rather than hang forever waiting on this).
  resolveSettingsReady();
}

export function init() {
  // Apply saved theme immediately
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);

  // Load payroll format
  loadCustomPayrollFormat();

  // Theme buttons
  if (btnThemeDark) {
    btnThemeDark.addEventListener('click', () => {
      localStorage.setItem('theme', 'dark');
      applyTheme('dark');
      showToast('Dark theme applied!');
    });
  }
  if (btnThemeLight) {
    btnThemeLight.addEventListener('click', () => {
      localStorage.setItem('theme', 'light');
      applyTheme('light');
      showToast('Light theme applied!');
    });
  }

  // Announcement
  if (btnPostAnnouncement) {
    btnPostAnnouncement.addEventListener('click', async () => {
      const msg = announcementInput ? announcementInput.value.trim() : '';
      if (!msg) return;
      try {
        await saveSettingRobust('announcement', msg);
        state.activeAnnouncement = msg;
        showToast('Announcement posted successfully!', 'success');
      } catch (e) {
        console.error(e);
        showToast('Failed to post announcement.', 'error');
        return;
      }

      // Retrieve the logged-in manager's name
      let senderName = '';
      if (state.currentUser && state.currentUser.name) {
        senderName = state.currentUser.name;
      } else {
        const saved = localStorage.getItem('lcw_web_user');
        if (saved) {
          try {
            senderName = JSON.parse(saved).name;
          } catch (e) {}
        }
      }

      // Send push notifications in the background (isolated so CORS/network failures don't block the post)
      try {
        const { data: rpcData, error: rpcErr } = await window.supabaseClient.rpc(
          'send_push_notification',
          { message: msg, sender_name: senderName },
        );

        if (rpcErr) {
          console.warn('Failed to send push notifications via database RPC:', rpcErr);
        } else {
          console.log('Push notification RPC result:', rpcData);
        }
      } catch (pushErr) {
        console.warn('Failed to invoke push notification RPC:', pushErr);
      }
    });
  }

  if (btnClearAnnouncement) {
    btnClearAnnouncement.addEventListener('click', async () => {
      try {
        await saveSettingRobust('announcement', '');
        state.activeAnnouncement = '';
        if (announcementInput) announcementInput.value = '';
        showToast('Announcement cleared!', 'success');
      } catch (e) {
        showToast('Failed to clear announcement.', 'error');
      }
    });
  }

  // Geofence save
  if (btnSaveGeofence) {
    btnSaveGeofence.addEventListener('click', async () => {
      const radius = parseInt(geofenceInput ? geofenceInput.value : '', 10);
      const lat = parseFloat(geofenceLatInput ? geofenceLatInput.value : '');
      const lon = parseFloat(geofenceLonInput ? geofenceLonInput.value : '');
      if (isNaN(radius) || radius <= 0 || isNaN(lat) || isNaN(lon)) {
        showToast('Please enter valid numbers for Radius, Latitude, and Longitude.', 'error');
        return;
      }
      try {
        await saveSettingRobust('geofence_radius', radius.toString());
        await saveSettingRobust('geofence_lat', lat.toString());
        await saveSettingRobust('geofence_lon', lon.toString());
        state.ALLOWED_RADIUS_METERS = radius;
        state.CAR_WASH_LAT = lat;
        state.CAR_WASH_LON = lon;
        showToast('Geofence settings updated!', 'success');
      } catch (err) {
        showToast('Error: ' + (err.message || 'Check database table and RLS policies.'), 'error');
      }
    });
  }

  // Geofence toggle
  if (btnToggleGeofence) {
    btnToggleGeofence.addEventListener('click', async () => {
      const newVal = !state.GEOFENCE_ENABLED;
      try {
        await saveSettingRobust('geofence_enabled', newVal.toString());
        state.GEOFENCE_ENABLED = newVal;
        updateGeofenceUI();
        showToast(`Geofence is now ${newVal ? 'Enabled' : 'Disabled'}`, 'success');
      } catch (e) {
        showToast('Failed to toggle geofence', 'error');
      }
    });
  }

  // Auto-fill coordinates
  if (btnGetCurrentLocation) {
    btnGetCurrentLocation.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation not supported by browser.', 'error');
        return;
      }
      showToast('Fetching your location...', 'success');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (geofenceLatInput) geofenceLatInput.value = pos.coords.latitude;
          if (geofenceLonInput) geofenceLonInput.value = pos.coords.longitude;
          showToast('Coordinates populated! Click Save Settings to apply.', 'success');
        },
        () => showToast('Failed to get location. Check permissions.', 'error'),
        { enableHighAccuracy: true },
      );
    });
  }

  // Anti-buddy toggle
  if (btnToggleAntiBuddy) {
    btnToggleAntiBuddy.addEventListener('click', async () => {
      const newVal = !state.ANTI_BUDDY_ENABLED;
      try {
        await saveSettingRobust('anti_buddy_enabled', newVal.toString());
        state.ANTI_BUDDY_ENABLED = newVal;
        updateAntiBuddyUI();

        showToast(`Anti-Buddy Verification is now ${newVal ? 'Enabled' : 'Disabled'}`, 'success');
      } catch (e) {
        showToast('Error: ' + (e.message || 'Failed to toggle Anti-Buddy.'), 'error');
      }
    });
  }

  // Early clock-in block toggle
  if (btnToggleEarlyBlock) {
    btnToggleEarlyBlock.addEventListener('click', async () => {
      const newVal = !state.EARLY_CLOCKIN_BLOCK_ENABLED;
      try {
        await saveSettingRobust('early_clockin_block_enabled', newVal.toString());
        state.EARLY_CLOCKIN_BLOCK_ENABLED = newVal;
        updateEarlyBlockUI();
        showToast(`Early Clock-In Block is now ${newVal ? 'Enabled' : 'Disabled'}`, 'success');
      } catch (e) {
        showToast('Failed to toggle Early Clock-In Block.', 'error');
      }
    });
  }

  // WiFi Lock Toggle
  if (btnToggleWifiLock) {
    btnToggleWifiLock.addEventListener('click', async () => {
      const newVal = !state.WIFI_LOCK_ENABLED;
      try {
        await saveSettingRobust('wifi_lock_enabled', newVal.toString());
        state.WIFI_LOCK_ENABLED = newVal;
        updateWifiLockUI();
        showToast(`WiFi Lock is now ${newVal ? 'Enabled' : 'Disabled'}`, 'success');
      } catch (e) {
        showToast('Failed to toggle WiFi Lock.', 'error');
      }
    });
  }

  // Get Current IP — must be run while connected to shop WiFi; stores the
  // public WAN IP that punches will be compared against (not a LAN address).
  if (btnGetCurrentIp) {
    btnGetCurrentIp.addEventListener('click', async () => {
      try {
        showToast('Fetching your public IP address...', 'success');
        const res = await fetch('https://api4.ipify.org?format=json');
        if (!res.ok) throw new Error(`ipify HTTP ${res.status}`);
        const data = await res.json();
        if (data && data.ip) {
          if (wifiIpInput) wifiIpInput.value = data.ip;
          showToast('Public IP populated! Click Save IP to apply.', 'success');
        } else {
          showToast('Failed to parse IP address.', 'error');
        }
      } catch (err) {
        showToast('Failed to fetch public IP address.', 'error');
      }
    });
  }

  // Save WiFi IP
  if (btnSaveWifiIp) {
    btnSaveWifiIp.addEventListener('click', async () => {
      const ip = (wifiIpInput ? wifiIpInput.value : '').trim();
      if (!ip) {
        showToast('Please enter an IP address.', 'error');
        return;
      }
      // The lock compares against the device's public WAN IP. A private LAN
      // address can never match, which previously made WiFi lock look broken.
      const first = ip.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)[0];
      if (first && isPrivateOrLocalIp(first)) {
        showToast(
          'That looks like a private LAN IP. Use "Set to Current IP" while on shop WiFi to capture the public address.',
          'error',
        );
        return;
      }
      try {
        await saveSettingRobust('wifi_ip_address', ip);
        state.WIFI_IP_ADDRESS = ip;
        showToast('WiFi IP address updated successfully!', 'success');
      } catch (err) {
        showToast('Failed to save WiFi IP address.', 'error');
      }
    });
  }

  // Payroll format modal
  if (btnEditPayrollFormat) {
    btnEditPayrollFormat.addEventListener('click', () => {
      if (modalEditPayrollFormat) modalEditPayrollFormat.classList.remove('hidden');
    });
  }
  if (btnCancelPayrollFormat) {
    btnCancelPayrollFormat.addEventListener('click', () => {
      if (modalEditPayrollFormat) modalEditPayrollFormat.classList.add('hidden');
    });
  }
  if (btnSavePayrollFormat) {
    btnSavePayrollFormat.addEventListener('click', async () => {
      state.customPayrollFormat.current = customCurrentFormatInput
        ? customCurrentFormatInput.value.trim()
        : '';
      state.customPayrollFormat.next = customNextFormatInput
        ? customNextFormatInput.value.trim()
        : '';
      try {
        await saveSettingRobust('custom_payroll_format', JSON.stringify(state.customPayrollFormat));
        showToast('Payroll format saved!', 'success');
        if (modalEditPayrollFormat) modalEditPayrollFormat.classList.add('hidden');
      } catch (e) {
        showToast('Failed to save payroll format', 'error');
      }
    });
  }

  // Security / 2FA
  if (btnShowSecurity) {
    btnShowSecurity.addEventListener('click', () => {
      const secSection = document.getElementById('manager-security-section');
      if (secSection) secSection.classList.toggle('hidden');

      // Keep the 2FA initialization just in case it's opened
      if (!state.currentManager) return;
      if (enable2FA) {
        enable2FA.checked = state.currentManager.two_factor_enabled || false;
        if (enable2FA.checked) {
          if (setup2FASection) setup2FASection.classList.remove('hidden');
          if (setup2FAPin) setup2FAPin.value = state.currentManager.two_factor_pin || '';
        } else {
          if (setup2FASection) setup2FASection.classList.add('hidden');
          if (setup2FAPin) setup2FAPin.value = '';
        }
      }
    });
  }

  if (enable2FA) {
    enable2FA.addEventListener('change', () => {
      if (!setup2FASection) return;
      if (enable2FA.checked) {
        setup2FASection.classList.remove('hidden');
      } else {
        setup2FASection.classList.add('hidden');
      }
    });
  }

  if (btnCloseSecurity) {
    btnCloseSecurity.addEventListener('click', () => {
      if (modalSecurity) modalSecurity.classList.add('hidden');
    });
  }

  if (btnSaveSecurity) {
    btnSaveSecurity.addEventListener('click', async () => {
      if (!state.currentManager) return;
      const isEnabled = enable2FA ? enable2FA.checked : false;
      const pin = setup2FAPin ? setup2FAPin.value : '';
      if (isEnabled && pin.length !== 4) {
        showToast('2-Step PIN must be 4 digits', 'error');
        return;
      }
      try {
        const { error } = await window.supabaseClient
          .from('users')
          .update({ two_factor_enabled: isEnabled, two_factor_pin: isEnabled ? pin : null })
          .eq('id', state.currentManager.id);
        if (error) throw error;
        state.currentManager.two_factor_enabled = isEnabled;
        state.currentManager.two_factor_pin = isEnabled ? pin : null;
        showToast('Security settings saved!', 'success');
        if (modalSecurity) modalSecurity.classList.add('hidden');
      } catch (err) {
        showToast('Failed to save security settings', 'error');
      }
    });
  }

  // Save Commission Rates
  if (btnSaveCommissions) {
    btnSaveCommissions.addEventListener('click', async () => {
      try {
        const singleGood = Math.round(parseFloat(commSingleGoodInput?.value || 0) * 100);
        const singleBetter = Math.round(parseFloat(commSingleBetterInput?.value || 0) * 100);
        const singleBest = Math.round(parseFloat(commSingleBestInput?.value || 0) * 100);
        const membershipGood = Math.round(parseFloat(commMembershipGoodInput?.value || 0) * 100);
        const membershipBetter = Math.round(parseFloat(commMembershipBetterInput?.value || 0) * 100);
        const membershipBest = Math.round(parseFloat(commMembershipBestInput?.value || 0) * 100);

        await Promise.all([
          saveSettingRobust('comm_single_good', singleGood.toString()),
          saveSettingRobust('comm_single_better', singleBetter.toString()),
          saveSettingRobust('comm_single_best', singleBest.toString()),
          saveSettingRobust('comm_membership_good', membershipGood.toString()),
          saveSettingRobust('comm_membership_better', membershipBetter.toString()),
          saveSettingRobust('comm_membership_best', membershipBest.toString()),
        ]);

        state.comm_single_good = singleGood;
        state.comm_single_better = singleBetter;
        state.comm_single_best = singleBest;
        state.comm_membership_good = membershipGood;
        state.comm_membership_better = membershipBetter;
        state.comm_membership_best = membershipBest;

        showToast('Commission rates saved successfully!', 'success');
      } catch (err) {
        showToast('Failed to save commission rates', 'error');
      }
    });
  }
}
