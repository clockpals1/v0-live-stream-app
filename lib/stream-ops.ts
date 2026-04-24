/**
 * Operator → Owner remote commands.
 *
 * Operators (and admins acting on an operator's stream) can't directly push
 * audio to viewers — only the stream owner's browser holds the WebRTC peer
 * connections. To let operators control mic mute and overlay-music playback
 * remotely we use the existing `chat-room-${streamId}` Supabase broadcast
 * channel. The operator emits one of these commands; the owner listens and
 * executes it locally.
 *
 * Event name on the broadcast channel: "operator-command".
 *
 * All mutations are also persisted in DB where appropriate so the UI on all
 * seats (operator, admin, owner) reflects the current state on refresh.
 */

export const OPERATOR_COMMAND_EVENT = "operator-command" as const;

export type OperatorCommand =
  | { op: "mic-toggle"; enable: boolean }
  | { op: "music-play" }
  | { op: "music-pause" }
  | { op: "music-stop" }
  | { op: "music-volume"; volume: number }
  | { op: "music-mix-mic"; mixWithMic: boolean };

export interface OperatorCommandEnvelope {
  command: OperatorCommand;
  /** Display name of the human who issued the command — shown as a toast on the owner's screen. */
  issuedBy: string;
  /** ISO timestamp, purely for debugging. */
  at: string;
}
