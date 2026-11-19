export const connection = {
  project: 'https://zddwdjlwqmlysegxrruz.supabase.co',
  key: 'sb_publishable_Ic_mUoZn5-WywZesME_j4w_8-8T46Tq',
};

const storageKey = 'everguard-account-session';

export function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (typeof saved?.access_token === 'string' && saved.expires_at * 1000 > Date.now()) return saved;
  } catch {
    // Signing in again replaces invalid storage.
  }
}

export function authorization(token) {
  return { apikey: connection.key, Authorization: 'Bearer ' + token };
}

export function returnToLogin() {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Login can still be opened when storage is unavailable.
  }
  location.replace('./login.html');
}

export function signOut(session) {
  fetch(new URL('/auth/v1/logout?scope=local', connection.project), {
    method: 'POST', headers: authorization(session.access_token), keepalive: true,
  }).catch(() => {});
  returnToLogin();
}

export async function validateSession(session) {
  const response = await fetch(new URL('/auth/v1/user', connection.project), {
    headers: authorization(session.access_token), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return;
  const user = await response.json();
  if (user.id) return user;
}

export function mountLogin() {
  const form = document.querySelector('#account-login');
  const status = document.querySelector('#account-status');
  const submit = form.querySelector('button');
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
      sessionStorage.setItem(storageKey, JSON.stringify({
        access_token: data.access_token, expires_at: data.expires_at, username: data.username,
      }));
      location.replace('./');
    } catch {
      status.textContent = 'Не удалось выполнить вход. Попробуйте ещё раз.';
    } finally {
      form.elements.password.value = '';
      submit.disabled = false;
    }
  });
}
