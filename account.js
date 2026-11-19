export function mountAccount(connection, onSessionChange) {
  const form = document.querySelector('#account-login');
  const logout = document.querySelector('#account-logout');
  const status = document.querySelector('#account-status');
  const submit = form.querySelector('button');
  const storageKey = 'everguard-account-session';
  let session;
  let expiryTimer;

  function render() {
    clearTimeout(expiryTimer);
    form.hidden = Boolean(session);
    logout.hidden = !session;
    onSessionChange(session?.access_token);
    if (session) {
      status.textContent = 'Вы вошли как ' + session.username;
      expiryTimer = setTimeout(() => {
        remember(undefined);
        status.textContent = 'Сессия истекла. Войдите снова.';
      }, Math.max(0, session.expires_at * 1000 - Date.now()));
    }
  }

  function remember(value) {
    session = value;
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Keep the session in memory when browser storage is unavailable.
    }
    render();
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved?.access_token && saved.expires_at * 1000 > Date.now()) session = saved;
  } catch {
    // An invalid stored session can be replaced by signing in again.
  }
  render();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'Выполняем вход…';
    const fields = new FormData(form);
    try {
      const response = await fetch(new URL('/functions/v1/username-login', connection.project), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      if (!response.ok) {
        status.textContent = data.error || 'Сервис входа недоступен.';
        return;
      }
      if (!data.access_token || !Number.isFinite(data.expires_at)) throw new Error('Invalid session');
      remember({ access_token: data.access_token, expires_at: data.expires_at, username: data.username });
    } catch {
      status.textContent = 'Не удалось подключиться к сервису входа.';
    } finally {
      form.elements.password.value = '';
      submit.disabled = false;
    }
  });

  logout.addEventListener('click', () => {
    const token = session?.access_token;
    remember(undefined);
    status.textContent = 'Вы вышли из аккаунта.';
    if (token) {
      fetch(new URL('/auth/v1/logout?scope=local', connection.project), {
        method: 'POST',
        headers: { apikey: connection.key, Authorization: 'Bearer ' + token },
      }).catch(() => {});
    }
  });
}
