/**
 * Modular WebRTC Connection Manager
 * Handles peer connections, signaling, and media stream management
 */

import { ICE_SERVERS, SignalMessage, RECONNECT_ATTEMPTS, RECONNECT_DELAY } from './config';

export class WebRTCConnectionManager {
  private peerConnection: RTCPeerConnection | null = null;
  private onTrackCallback?: (stream: MediaStream) => void;
  private onConnectionStateChangeCallback?: (state: string) => void;
  private onIceCandidateCallback?: (candidate: RTCIceCandidateInit) => void;
  private reconnectAttempts = 0;

  constructor() {
    this.initializePeerConnection();
  }

  /**
   * Initialize a fresh RTCPeerConnection
   */
  private initializePeerConnection(): void {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for the peer connection
   */
  private setupEventHandlers(): void {
    if (!this.peerConnection) return;

    this.peerConnection.ontrack = (event) => {
      console.log('[ConnectionManager] Received track:', event.track.kind, event.streams.length);
      
      if (event.streams.length > 0) {
        const stream = event.streams[0];
        console.log('[ConnectionManager] Stream received with tracks:', stream.getTracks().length);
        this.onTrackCallback?.(stream);
      }
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ConnectionManager] ICE candidate generated');
        this.onIceCandidateCallback?.(event.candidate.toJSON());
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState || 'unknown';
      console.log('[ConnectionManager] Connection state:', state);
      this.onConnectionStateChangeCallback?.(state);
      
      if (state === 'connected') {
        this.reconnectAttempts = 0;
      } else if (state === 'failed' || state === 'disconnected') {
        this.handleConnectionFailure();
      }
    };

    this.peerConnection.onicegatheringstatechange = () => {
      const state = this.peerConnection?.iceGatheringState || 'unknown';
      console.log('[ConnectionManager] ICE gathering state:', state);
    };
  }

  /**
   * Handle connection failure with reconnection logic
   */
  private handleConnectionFailure(): void {
    if (this.reconnectAttempts < RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      console.log(`[ConnectionManager] Connection failed, attempting reconnection ${this.reconnectAttempts}/${RECONNECT_ATTEMPTS}`);
      
      setTimeout(() => {
        this.initializePeerConnection();
      }, RECONNECT_DELAY);
    } else {
      console.error('[ConnectionManager] Max reconnection attempts reached');
    }
  }

  /**
   * Create and send an offer
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      });

      await this.peerConnection.setLocalDescription(offer);
      console.log('[ConnectionManager] Offer created and set as local description');
      return offer;
    } catch (error) {
      console.error('[ConnectionManager] Error creating offer:', error);
      throw error;
    }
  }

  /**
   * Handle an incoming offer
   */
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await this.peerConnection.createAnswer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      });
      
      await this.peerConnection.setLocalDescription(answer);
      console.log('[ConnectionManager] Answer created and set as local description');
      return answer;
    } catch (error) {
      console.error('[ConnectionManager] Error handling offer:', error);
      throw error;
    }
  }

  /**
   * Handle an incoming answer
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[ConnectionManager] Answer set as remote description');
    } catch (error) {
      console.error('[ConnectionManager] Error handling answer:', error);
      throw error;
    }
  }

  /**
   * Add an ICE candidate
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('[ConnectionManager] ICE candidate added');
    } catch (error) {
      console.error('[ConnectionManager] Error adding ICE candidate:', error);
      throw error;
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): string {
    return this.peerConnection?.connectionState || 'unknown';
  }

  /**
   * Check if connection is established
   */
  isConnected(): boolean {
    return this.peerConnection?.connectionState === 'connected';
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }

  /**
   * Set event callbacks
   */
  setOnTrack(callback: (stream: MediaStream) => void): void {
    this.onTrackCallback = callback;
  }

  setOnConnectionStateChange(callback: (state: string) => void): void {
    this.onConnectionStateChangeCallback = callback;
  }

  setOnIceCandidate(callback: (candidate: RTCIceCandidateInit) => void): void {
    this.onIceCandidateCallback = callback;
  }

  /**
   * Add media stream to the connection
   */
  addStream(stream: MediaStream): void {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    stream.getTracks().forEach(track => {
      this.peerConnection!.addTrack(track, stream);
    });
    console.log('[ConnectionManager] Media stream added to connection');
  }

  /**
   * Remove media stream from the connection
   */
  removeStream(stream: MediaStream): void {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    stream.getTracks().forEach(track => {
      const sender = this.peerConnection!.getSenders().find(s => s.track === track);
      if (sender) {
        this.peerConnection!.removeTrack(sender);
      }
    });
    console.log('[ConnectionManager] Media stream removed from connection');
  }
}
