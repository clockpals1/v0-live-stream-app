// WebRTC Configuration for Isunday Stream Live
// Supports up to 50 viewers with peer-to-peer connections

export const MAX_VIEWERS = 50;
export const MIN_VIEWERS = 20;
export const RECONNECT_ATTEMPTS = 3;
export const RECONNECT_DELAY = 2000;

// ICE servers configuration - using free STUN and TURN servers
export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    // Open Relay TURN servers (free, for demo purposes)
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};

// Signaling message types
export type SignalType = 
  | "offer"
  | "answer"
  | "ice-candidate"
  | "viewer-join"
  | "viewer-leave"
  | "stream-start"
  | "stream-end"
  | "track-toggle";

export interface SignalMessage {
  type: SignalType;
  from: string;
  to?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | { video?: boolean; audio?: boolean } | null;
  viewerName?: string;
}

// Media constraints for the host
export const HOST_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: "user",
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};
