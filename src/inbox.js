/**
 * Per-bot mention inbox + long-poll.
 * Timeout is a NORMAL result, never an error.
 * Mentions that land while no waiter is parked go to inbox and drain first.
 */
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 45;

export const TIMEOUT_PAYLOAD = {
  timed_out: true,
  message: null,
  instruction: "No one called you. Call wait_for_mention again immediately.",
};

export function createInbox() {
  const inbox = [];
  const waiters = [];

  function deliver(msg) {
    return {
      timed_out: false,
      from: msg.from,
      fromBot: msg.fromBot ?? false,
      isAll: msg.isAll ?? false,
      stopped: msg.stopped ?? false,
      text: msg.text,
      speaker_position: msg.speaker_position ?? null,
      distance: msg.distance ?? null,
      summary: `${msg.from} said: "${msg.text}"`,
      message: msg.text,
    };
  }

  function push(msg) {
    if (waiters.length) {
      const w = waiters.shift();
      clearTimeout(w.timer);
      w.resolve(deliver(msg));
      return;
    }
    inbox.push(msg);
  }

  function wait(timeoutSeconds = DEFAULT_TIMEOUT_SECONDS) {
    const sec = Math.min(
      Math.max(Number(timeoutSeconds) || DEFAULT_TIMEOUT_SECONDS, 1),
      MAX_TIMEOUT_SECONDS,
    );
    if (inbox.length) return Promise.resolve(deliver(inbox.shift()));
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        resolve({ ...TIMEOUT_PAYLOAD });
      }, sec * 1000);
      waiters.push(waiter);
    });
  }

  function cancelAll() {
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve({ ...TIMEOUT_PAYLOAD });
    }
    waiters.length = 0;
  }

  return { push, wait, cancelAll, clear: () => { inbox.length = 0; }, size: () => inbox.length };
}
