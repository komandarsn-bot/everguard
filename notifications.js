const metrics = [
  ['temperature', 'Температура', '°C', 0.5, 0.1, 120],
  ['humidity', 'Влажность', 'п. п.', 10, 1, 100],
  ['mq2', 'MQ‑2', 'АЦП', 500, 1, 4095],
  ['mq135', 'MQ‑135', 'АЦП', 300, 1, 4095],
];

export async function mountNotifications(connection, userId) {
  const form = document.querySelector('#notification-rules');
  const fields = document.querySelector('#notification-rule-fields');
  const formStatus = document.querySelector('#notification-rule-status');
  const inbox = document.querySelector('#notification-inbox');
  const historyStatus = document.querySelector('#notification-history-status');
  const list = document.querySelector('#notification-history');
  const rulesUrl = new URL('/rest/v1/everguard_notification_rules', connection.project);
  const historyUrl = new URL('/rest/v1/everguard_notification_history', connection.project);
  rulesUrl.searchParams.set('select', 'metric,enabled,threshold');
  historyUrl.search = new URLSearchParams({ select: 'title,body,recorded_at', order: 'recorded_at.desc', limit: '50' });
  const fetchOptions = () => ({ headers: connection.headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });

  try {
    const result = await fetch(rulesUrl, fetchOptions());
    if (!result.ok) return;
    const rules = await result.json();
    for (const [metric, label, unit, fallback, step, max] of metrics) {
      const current = rules.find(rule => rule.metric === metric);
      const field = document.createElement('fieldset');
      field.innerHTML = `<legend>${label}</legend>
        <label><input name="${metric}-enabled" type="checkbox"> Включить</label>
        <label>Порог, ${unit}<input name="${metric}" type="number" min="${step}" max="${max}" step="${step}" required></label>`;
      field.querySelector('[type=checkbox]').checked = current?.enabled ?? true;
      field.querySelector('[type=number]').value = current?.threshold ?? fallback;
      fields.append(field);
    }
  } catch {
    return;
  }
  form.hidden = false;
  inbox.hidden = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    formStatus.textContent = 'Сохраняем пороги…';
    const data = new FormData(form);
    try {
      const response = await fetch(rulesUrl, {
        ...fetchOptions(),
        method: 'POST',
        headers: { ...connection.headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(metrics.map(([metric]) => ({
          user_id: userId, metric, enabled: data.has(metric + '-enabled'), threshold: Number(data.get(metric)),
        }))),
      });
      if (!response.ok) throw new Error('Could not save rules');
      formStatus.textContent = 'Пороги сохранены.';
    } catch {
      formStatus.textContent = 'Не удалось сохранить пороги.';
    } finally {
      button.disabled = false;
    }
  });

  let loading = false;
  async function loadHistory() {
    if (!inbox.open || loading) return;
    loading = true;
    try {
      const response = await fetch(historyUrl, fetchOptions());
      if (!response.ok) throw new Error('Could not load notifications');
      const rows = await response.json();
      list.replaceChildren(...rows.map(row => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        const date = document.createElement('time');
        const body = document.createElement('p');
        const timestamp = new Date(row.recorded_at);
        title.textContent = row.title;
        date.dateTime = row.recorded_at;
        date.textContent = timestamp.toLocaleString('ru-KZ');
        body.textContent = row.body;
        item.append(title, date, body);
        return item;
      }));
      historyStatus.textContent = rows.length ? '' : 'Уведомлений пока нет.';
    } catch {
      historyStatus.textContent = 'Не удалось загрузить историю уведомлений.';
    } finally {
      loading = false;
    }
  }
  inbox.addEventListener('toggle', loadHistory);
  setInterval(loadHistory, 15000);
}
