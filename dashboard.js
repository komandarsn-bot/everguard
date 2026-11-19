import { authorization, connection, readSession, returnToLogin, signOut, validateSession } from './account.js?v=signin';
import { mountHistory } from './history.js?v=signin';
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
      headers: connection.headers,
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

async function startDashboard() {
  const session = readSession();
  const user = session && await validateSession(session).catch(() => undefined);
  if (!user) {
    returnToLogin();
    return;
  }

  const headers = authorization(session.access_token);
  const dataConnection = { ...connection, headers };
  const settingsUrl = new URL('/rest/v1/everguard_account_settings', connection.project);
  const syncStatus = document.querySelector('#refresh-settings-status');
  const logout = document.querySelector('#account-logout');

  document.querySelector('#account-status').textContent = 'Вы вошли как ' + session.username;
  logout.addEventListener('click', () => {
    document.querySelector('.layout').hidden = true;
    signOut(session);
  });
  setTimeout(returnToLogin, Math.max(0, session.expires_at * 1000 - Date.now()));
  document.querySelector('.layout').hidden = false;

  updateHistory = mountHistory(dataConnection);
  connect(dataConnection);
  mountPush(connection);
  intervalControl.disabled = true;
  syncStatus.textContent = 'Загружаем настройку аккаунта…';
  try {
    const response = await fetch(settingsUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Settings lookup failed');
    const [saved] = await response.json();
    intervalControl.value = String(saved?.refresh_seconds ?? 5);
    syncStatus.textContent = 'Настройка сохраняется в аккаунте.';
  } catch {
    syncStatus.textContent = 'Не удалось загрузить настройку аккаунта.';
  } finally {
    intervalControl.disabled = false;
  }

  intervalControl.addEventListener('change', async () => {
    intervalControl.disabled = true;
    syncStatus.textContent = 'Сохраняем настройку аккаунта…';
    clearTimeout(timer);
    refresh(dataConnection, ++settingsVersion);
    try {
      const response = await fetch(settingsUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: user.id, refresh_seconds: Number(intervalControl.value) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Settings update failed');
      syncStatus.textContent = 'Настройка сохранена в аккаунте.';
    } catch {
      syncStatus.textContent = 'Интервал применён здесь. Сохранить его в аккаунте не удалось.';
    } finally {
      intervalControl.disabled = false;
    }
  });
}

startDashboard();
