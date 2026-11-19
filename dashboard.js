import { mountHistory } from './history.js?v=full-history';
import { mountPush } from './push.js?v=test';

const status = document.querySelector('#status');
const panel = document.querySelector('#status-panel');
const label = document.querySelector('#status-label');
const fields = ['temperature', 'humidity', 'mq2', 'mq135'];
const formatReading = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
const formatChange = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2, signDisplay: 'always' });
const readings = fields.map((field) => {
  const output = document.getElementById(field);
  const metric = output.closest('.metric');
  const delta = document.createElement('span');
  delta.className = 'delta';
  metric.append(delta);
  return { field, output, metric, delta, value: null, timeout: undefined };
});
let settingsVersion = 0;
let updatedAt;
let timer;
const intervalControl = document.querySelector('#refresh-interval');
const intervalKey = 'everguard-refresh-interval';
const intervals = ['5', '10', '30', '60'];
try {
  const saved = localStorage.getItem(intervalKey);
  if (intervals.includes(saved)) intervalControl.value = saved;
} catch {
  // Keep the default when storage is unavailable.
}
let updateHistory;

function showStatus(state, title, detail) {
  panel.dataset.state = state;
  label.textContent = title;
  if (status.textContent !== detail) status.textContent = detail;
}

function render(row) {
  for (const reading of readings) {
    const value = row?.[reading.field] == null ? null : Number(row[reading.field]);
    if (value === reading.value) continue;
    const previous = reading.value;
    reading.value = value;
    reading.output.textContent = value === null ? '—' : formatReading.format(value);
    clearTimeout(reading.timeout);
    delete reading.metric.dataset.change;
    reading.delta.textContent = '';
    if (previous !== null && value !== null) {
      const change = Math.round((value - previous) * 100) / 100;
      if (!change) continue;
      reading.metric.dataset.change = change > 0 ? 'up' : 'down';
      reading.delta.textContent = formatChange.format(change);
      reading.timeout = setTimeout(() => {
        delete reading.metric.dataset.change;
        reading.delta.textContent = '';
      }, 4000);
    }
  }
}

async function refresh(connection, version) {
  try {
    const endpoint = new URL('/rest/v1/sensor_readings', connection.project);
    endpoint.search = new URLSearchParams({
      select: ['id', ...fields, 'recorded_at'].join(','),
      order: 'id.desc',
      limit: '1',
    });
    const response = await fetch(endpoint, {
      headers: { apikey: connection.key },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const [row] = await response.json();
    if (version !== settingsVersion) return;
    render(row);
    if (row) updateHistory?.(row);
    updatedAt = row?.recorded_at;
    const time = updatedAt && new Date(updatedAt);
    if (!time) {
      showStatus('loading', 'Ожидание данных', 'В базе пока нет показаний.');
    } else {
      const stale = Date.now() - time.getTime() > 90000;
      showStatus(stale ? 'stale' : 'live', stale ? 'Нет свежих данных' : 'Данные поступают',
        'Последняя запись · ' + time.toLocaleString('ru-KZ'));
    }
  } catch {
    if (version !== settingsVersion) return;
    showStatus('error', 'Ошибка подключения', updatedAt
      ? 'Нет связи с базой · последняя запись ' + new Date(updatedAt).toLocaleString('ru-KZ')
      : 'Не удалось загрузить показания. Повторяем запрос…');
  } finally {
    if (version === settingsVersion) timer = setTimeout(() => refresh(connection, version), Number(intervalControl.value) * 1000);
  }
}

function connect(connection) {
  clearTimeout(timer);
  updatedAt = undefined;
  render();
  status.textContent = 'Читаем показания…';
  refresh(connection, ++settingsVersion);
}

const connection = {
  project: 'https://zddwdjlwqmlysegxrruz.supabase.co',
  key: 'sb_publishable_Ic_mUoZn5-WywZesME_j4w_8-8T46Tq',
};
updateHistory = mountHistory(connection);
const syncStatus = document.querySelector('#refresh-settings-status');
const settingsUrl = new URL('/rest/v1/everguard_account_settings', connection.project);
let accountSettings;
let accountVersion = 0;

function refreshNow() {
  clearTimeout(timer);
  refresh(connection, ++settingsVersion);
}

async function syncAccount(token) {
  const version = ++accountVersion;
  accountSettings = undefined;
  intervalControl.disabled = Boolean(token);
  try {
    if (!token) {
      intervalControl.value = '5';
      const saved = localStorage.getItem(intervalKey);
      if (intervals.includes(saved)) intervalControl.value = saved;
      refreshNow();
      return;
    }
    syncStatus.textContent = 'Загружаем настройку аккаунта…';
    const headers = { apikey: connection.key, Authorization: 'Bearer ' + token };
    const userResponse = await fetch(new URL('/auth/v1/user', connection.project), { headers, signal: AbortSignal.timeout(8000) });
    if (!userResponse.ok) throw new Error('Account lookup failed');
    const user = await userResponse.json();
    const response = await fetch(settingsUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Settings lookup failed');
    const [saved] = await response.json();
    if (version !== accountVersion) return;
    accountSettings = { id: user.id, headers };
    intervalControl.value = String(saved?.refresh_seconds ?? 5);
    syncStatus.textContent = 'Настройка применяется на устройствах этого аккаунта при входе.';
    refreshNow();
  } catch {
    if (version === accountVersion && token) syncStatus.textContent = 'Настройки аккаунта недоступны. Войдите снова, чтобы повторить.';
  } finally {
    if (version === accountVersion) {
      intervalControl.disabled = false;
      if (!token) syncStatus.textContent = 'Настройка сохраняется в этом браузере.';
    }
  }
}

intervalControl.addEventListener('change', async () => {
  const account = accountSettings;
  if (account) {
    const version = accountVersion;
    intervalControl.disabled = true;
    syncStatus.textContent = 'Сохраняем настройку аккаунта…';
    refreshNow();
    try {
      const response = await fetch(settingsUrl, {
        method: 'POST',
        headers: { ...account.headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: account.id, refresh_seconds: Number(intervalControl.value) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Settings update failed');
      if (version === accountVersion) syncStatus.textContent = 'Настройка сохранена в аккаунте.';
    } catch {
      if (version === accountVersion) syncStatus.textContent = 'Интервал применён здесь. Сохранить его в аккаунте не удалось.';
    } finally {
      if (version === accountVersion) intervalControl.disabled = false;
    }
    return;
  }
  try {
    localStorage.setItem(intervalKey, intervalControl.value);
  } catch {
    // The interval still applies until the page is closed.
  }
  refreshNow();
});
connect(connection);
mountPush(connection);
import { mountAccount } from './account.js?v=sync';
mountAccount(connection, syncAccount);
