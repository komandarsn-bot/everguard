const units = { temperature: '°C', humidity: '%', mq2: 'АЦП', mq135: 'АЦП' };
const number = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 });
const hour = 3600000;
const axisTime = new Intl.DateTimeFormat('ru-KZ', { hour: '2-digit', minute: '2-digit' });
const pointTime = new Intl.DateTimeFormat('ru-KZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function mountHistory(connection) {
  const sensor = document.querySelector('#history-sensor');
  const range = document.querySelector('#history-range');
  const refresh = document.querySelector('#history-refresh');
  const canvas = document.querySelector('#history-chart');
  const context = canvas.getContext('2d');
  const message = document.querySelector('#history-message');
  const summary = document.querySelector('#history-summary');
  const detail = document.querySelector('#history-point');
  let points = [];
  let selected = -1;
  let start;
  let end;
  let request;
  let bounds;
  let unit;
  let latest;
  let loaded = false;
  let lastId;

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || !context) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    if (!points.length) return;

    let min = points[0].value;
    let max = min;
    for (const { value } of points) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const pad = Math.max((max - min) * 0.12, sensor.value.startsWith('mq') ? 1 : 0.25);
    const low = min - pad;
    const high = max + pad;
    const left = 53;
    const right = width - 20;
    const top = 14;
    const bottom = height - 32;
    bounds = { left, right };
    const x = (time) => left + (time - start) / (end - start) * (right - left);
    const y = (value) => bottom - (value - low) / (high - low) * (bottom - top);

    context.font = '11px system-ui, sans-serif';
    context.fillStyle = '#526172';
    context.strokeStyle = '#e2e8ef';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const value = low + (high - low) * i / 4;
      const lineY = y(value);
      context.beginPath();
      context.moveTo(left, lineY);
      context.lineTo(right, lineY);
      context.stroke();
      context.fillText(number.format(value), left - 8, lineY, left - 10);
    }

    const ticks = width < 460 ? 2 : 4;
    context.textBaseline = 'top';
    for (let i = 0; i <= ticks; i++) {
      const time = start + (end - start) * i / ticks;
      context.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center';
      context.fillText(axisTime.format(time), x(time), bottom + 10);
    }

    context.strokeStyle = '#2865a6';
    context.lineWidth = 1.7;
    context.beginPath();
    points.forEach(({ time, value }, i) => {
      if (i === 0 || time - points[i - 1].time > 120000) context.moveTo(x(time), y(value));
      else context.lineTo(x(time), y(value));
    });
    context.stroke();

    if (points.length <= 90) {
      context.fillStyle = '#2865a6';
      for (const point of points) {
        context.beginPath();
        context.arc(x(point.time), y(point.value), 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }

    const current = points[selected] ?? points.at(-1);
    const pointX = x(current.time);
    const pointY = y(current.value);
    if (selected >= 0) {
      context.strokeStyle = '#8194a8';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(pointX, top);
      context.lineTo(pointX, bottom);
      context.stroke();
    }
    context.fillStyle = '#2865a6';
    context.beginPath();
    context.arc(pointX, pointY, 4, 0, Math.PI * 2);
    context.fill();
    summary.textContent = 'Мин. ' + number.format(min) + ' · Макс. ' + number.format(max) + ' ' + unit;
    detail.textContent = pointTime.format(current.time) + ' · ' + number.format(current.value) + ' ' + unit;
  }

  async function load() {
    request?.abort();
    const active = new AbortController();
    request = active;
    loaded = false;
    const column = sensor.value;
    unit = units[column];
    end = Date.now();
    start = end - Number(range.value) * hour;
    points = [];
    selected = -1;
    bounds = undefined;
    summary.textContent = '';
    detail.textContent = '';
    message.hidden = false;
    message.textContent = 'Загружаем историю…';
    draw();

    const rows = [];
    const endpoint = new URL('/rest/v1/sensor_readings', connection.project);
    endpoint.search = new URLSearchParams({
      select: 'id,recorded_at,' + column,
      recorded_at: 'gte.' + new Date(start).toISOString(),
      order: 'id.desc',
      limit: '1000',
    });
    endpoint.searchParams.append('recorded_at', 'lte.' + new Date(end).toISOString());
    try {
      while (!active.signal.aborted) {
        const response = await fetch(endpoint, {
          headers: { apikey: connection.key },
          signal: AbortSignal.any([active.signal, AbortSignal.timeout(10000)]),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const page = await response.json();
        if (active.signal.aborted) return;
        rows.push(...page);
        if (page.length < 1000) break;
        endpoint.searchParams.set('id', 'lt.' + page.at(-1).id);
      }
      if (active.signal.aborted) return;
      points = rows.filter((row) => row[column] != null).map((row) => ({
        id: row.id,
        time: Date.parse(row.recorded_at),
        value: Number(row[column]),
      })).filter(({ time, value }) => Number.isFinite(time) && Number.isFinite(value))
        .sort((a, b) => a.time - b.time);
      lastId = rows[0]?.id;
      loaded = true;
      message.hidden = points.length > 0;
      message.textContent = points.length ? '' : 'За выбранный период записей нет.';
      if (latest && appendLatest(latest)) return;
      draw();
    } catch {
      if (active.signal.aborted) return;
      message.textContent = 'Не удалось загрузить историю. Попробуйте обновить график.';
    }
  }

  function appendLatest(row) {
    const time = Date.parse(row.recorded_at);
    const value = row[sensor.value];
    if (!loaded || (lastId != null && row.id <= lastId) ||
        time < start || !Number.isFinite(time) || value == null || !Number.isFinite(Number(value))) return false;
    lastId = row.id;
    const previousSelection = points[selected];
    end = Math.max(end, time, Date.now());
    start = end - Number(range.value) * hour;
    points.push({ id: row.id, time, value: Number(value) });
    points = points.filter((point) => point.time >= start).sort((a, b) => a.time - b.time);
    selected = previousSelection ? points.indexOf(previousSelection) : -1;
    message.hidden = points.length > 0;
    draw();
    return true;
  }

  function selectAt(event) {
    if (!bounds || !points.length) return;
    const offset = event.clientX - canvas.getBoundingClientRect().left;
    const time = start + (end - start) * (offset - bounds.left) / (bounds.right - bounds.left);
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const middle = Math.floor((lo + hi) / 2);
      if (points[middle].time < time) lo = middle + 1;
      else hi = middle;
    }
    const index = lo && time - points[lo - 1].time < points[lo].time - time ? lo - 1 : lo;
    if (selected === index) return;
    selected = index;
    draw();
  }

  sensor.addEventListener('change', load);
  range.addEventListener('change', load);
  refresh.addEventListener('click', load);
  canvas.addEventListener('pointermove', selectAt);
  canvas.addEventListener('pointerdown', selectAt);
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    selected = -1;
    draw();
  });
  canvas.addEventListener('keydown', (event) => {
    if (!points.length || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const index = selected < 0 ? points.length - 1 : selected;
    selected = Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    draw();
  });
  new ResizeObserver(draw).observe(canvas);
  load();
  return (row) => {
    latest = row;
    appendLatest(row);
  };
}
