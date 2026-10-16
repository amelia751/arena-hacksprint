/**
 * Whether a play tool is actually running in this page.
 *
 * An assistant only exists while it is answering. The board used to say
 * "thinking" whenever it was the other seat's turn, which stays true long
 * after the chat has gone quiet. The tools themselves are the only honest
 * signal: if none of them is in flight, nobody is thinking.
 */

let inflight = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function beginAgentRun() {
  inflight += 1;
  emit();
}

export function endAgentRun() {
  inflight = Math.max(0, inflight - 1);
  emit();
}

export function agentIsRunning() {
  return inflight > 0;
}

export function subscribeAgentRun(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
