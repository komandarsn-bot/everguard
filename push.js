export async function mountPush(connection) {
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return;
  const controls = document.querySelector('#push-controls');
  const button = document.querySelector('#push-button');
  const status = document.querySelector('#push-status');
  const endpoint = new URL('/functions/v1/sensor-push/', connection.project);

  async function send(action, subscription) {
    const response = await fetch(new URL(action, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    if (!response.ok) throw new Error('Push HTTP ' + response.status);
  }

  try {
    const config = await fetch(new URL('public-key', endpoint), { signal: AbortSignal.timeout(6000) });
    if (!config.ok) return;
    const { publicKey } = await config.json();
    const registration = await navigator.serviceWorker.register('./push-worker.js');
    const ready = await navigator.serviceWorker.ready;
    let subscription = await ready.pushManager.getSubscription();

    function render() {
      button.textContent = subscription ? 'Отключить уведомления' : 'Включить уведомления';
    }

    if (subscription) await send('subscribe', subscription);
    render();
    controls.hidden = false;

    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        if (subscription) {
          await send('unsubscribe', subscription);
          await subscription.unsubscribe();
          subscription = null;
          status.textContent = 'Уведомления отключены.';
        } else {
          if (await Notification.requestPermission() !== 'granted') {
            status.textContent = 'Чтобы получать уведомления, разрешите их в настройках браузера.';
            return;
          }
          const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
          const key = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const candidate = await registration.pushManager.subscribe({
            userVisibleOnly: true, applicationServerKey: key,
          });
          try {
            await send('subscribe', candidate);
          } catch (error) {
            await candidate.unsubscribe();
            throw error;
          }
          subscription = candidate;
          status.textContent = 'Уведомления включены на этом устройстве.';
        }
      } catch {
        status.textContent = 'Не удалось изменить подписку. Попробуйте ещё раз.';
      } finally {
        render();
        button.disabled = false;
      }
    });
  } catch {
    // A missing or unconfigured push function leaves the dashboard usable.
  }
}

