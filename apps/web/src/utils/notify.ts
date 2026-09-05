/** Desktop notification, only when the tab is hidden and permission was granted. */
export function notify(title: string, body?: string) {
	if (!('Notification' in window) || !document.hidden || Notification.permission !== 'granted') return;
	const n = new Notification(title, { body, icon: '/icon.svg', tag: 'rubrik' });
	n.onclick = () => {
		window.focus();
		n.close();
	};
}

/** Ask once, from a user gesture (seek / challenge click). */
export function requestNotifyPermission() {
	if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
}
