const status = document.querySelector('#status');
const panel = document.querySelector('#status-panel');
const label = document.querySelector('#status-label');
const fields = ['temperature', 'humidity', 'mq2', 'mq135'];
let settingsVersion = 0;
let updatedAt;
let timer;

function showStatus(state, title, detail) {
  panel.dataset.state = state;
  label.textContent = title;
  if (status.textContent !== detail) status.textContent = detail;
}

function render(row) {
  for (const field of fields) {
    document.getElementById(field).textContent = row ? Number(row[field]).toLocaleString('ru-KZ') : '—';
  }
}

async function refresh(connection, version) {
  try {
    const endpoint = new URL('/rest/v1/sensor_readings', connection.project);
    endpoint.search = new URLSearchParams({
      select: [...fields, 'recorded_at'].join(','),
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
    if (version === settingsVersion) timer = setTimeout(() => refresh(connection, version), 5000);
  }
}

function connect(connection) {
  clearTimeout(timer);
  updatedAt = undefined;
  render();
  status.textContent = 'Читаем показания…';
  refresh(connection, ++settingsVersion);
}

connect({
  project: 'https://zddwdjlwqmlysegxrruz.supabase.co',
  key: 'sb_publishable_Ic_mUoZn5-WywZesME_j4w_8-8T46Tq',
});
