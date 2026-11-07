// Embedded in another game (Toret City's console): loaded in
// an iframe with `?embed=1`, the duel tells the page round it what happens
// by postMessage, tagged with the protocol so nothing else posted counts.
// The page can't hear keys pressed in here (Esc included), so leaving is
// ours to offer: Q while paused or at the match banner.

export const PROTOCOL = 'toret-minigame/1';

/** Whether the duel is embedded: asked for, and inside another page. */
export const EMBEDDED =
  new URLSearchParams(window.location.search).has('embed') && window.parent !== window;

export type EmbedMessage =
  | { type: 'ready' }
  /** A match decided: whether P1 (the player) won, and the score, P1 first. */
  | { type: 'result'; won: boolean; score: [number, number] }
  | { type: 'exit' };

/** Tells the page round the duel, if embedded. */
export function tellHost(message: EmbedMessage): void {
  if (!EMBEDDED) return;
  // Nothing private is said, so any page embedding the duel may hear it.
  window.parent.postMessage({ protocol: PROTOCOL, ...message }, '*');
}
