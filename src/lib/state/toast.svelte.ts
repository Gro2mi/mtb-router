/**
 * Minimal toast queue (E1.4/E1.5): transient, non-blocking status messages.
 */
export interface ToastMsg {
  id: number;
  text: string;
}

let seq = 0;

export const toasts = $state<ToastMsg[]>([]);

export function toast(text: string, durationMs = 3200): void {
  const id = ++seq;
  toasts.push({ id, text });
  setTimeout(() => {
    const index = toasts.findIndex((t) => t.id === id);
    if (index !== -1) toasts.splice(index, 1);
  }, durationMs);
}
