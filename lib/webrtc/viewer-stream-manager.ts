/**
 * Modular Viewer Stream Manager
 * Handles viewer-side streaming with automatic video connection
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { WebRTCConnectionManager } from './connection-manager';
import { SignalMessage } from './config';

interface ViewerStreamManagerProps {
  streamId: string;
  roomCode: string;
  viewerName: string;
  onStreamEnd?: () => void;
  onStreamStart?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

export class ViewerStreamManager {
  private connectionManager: WebRTCConnectionManager;
  private channel: RealtimeChannel | null = null;
  private viewerId: string;
  private streamId: string;
  private roomCode: string;
  private viewerName: string;
  private supabase = createClient();

  // State callbacks
  private onRemoteStreamCallback?: (stream: MediaStream) => void;
  private onIsConnectedCallback?: (connected: boolean) => void;
  private onIsStreamLiveCallback?: (live: boolean) => void;
  private onErrorCallback?: (error: string | null) => void;
  private onHostVideoEnabledCallback?: (enabled: boolean) => void;
  private onHostAudioEnabledCallback?: (enabled: boolean) => void;

  constructor(props: ViewerStreamManagerProps) {
    this.streamId = props.streamId;
    this.roomCode = props.roomCode;
    this.viewerName = props.viewerName;
    this.viewerId = Math.random().toString(36).substr(2, 9);

    this.connectionManager = new WebRTCConnectionManager();
    this.setupConnectionCallbacks();
  }

  /**
   * Setup connection manager callbacks
   */
  private setupConnectionCallbacks(): void {
    this.connectionManager.setOnTrack((stream: MediaStream) => {
      console.log('[ViewerManager] Track received, setting remote stream');
      
      // Extract track states
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      
      // Update host track states
      if (videoTracks.length > 0) {
        this.onHostVideoEnabledCallback?.(!videoTracks[0].muted);
        console.log('[ViewerManager] Video track enabled:', !videoTracks[0].muted);
      }
      
      if (audioTracks.length > 0) {
        this.onHostAudioEnabledCallback?.(!audioTracks[0].muted);
        console.log('[ViewerManager] Audio track enabled:', !audioTracks[0].muted);
      }
      
      this.onRemoteStreamCallback?.(stream);
      this.onIsConnectedCallback?.(true);
      this.onErrorCallback?.(null);
    });

    this.connectionManager.setOnConnectionStateChange((state: string) => {
      console.log('[ViewerManager] Connection state changed:', state);
      
      if (state === 'connected') {
        this.onIsConnectedCallback?.(true);
        this.onErrorCallback?.(null);
      } else if (state === 'failed' || state === 'disconnected') {
        this.onIsConnectedCallback?.(false);
        this.onRemoteStreamCallback?.(null as any);
      }
    });

    this.connectionManager.setOnIceCandidate((candidate) => {
      this.sendSignal({
        type: 'ice-candidate',
        from: this.viewerId,
        to: 'host',
        payload: candidate,
      });
    });
  }

  /**
   * Initialize the stream manager
   */
  async initialize(): Promise<void> {
    try {
      console.log('[ViewerManager] Initializing stream manager');
      
      // Setup signaling channel
      await this.setupSignalingChannel();
      
      // Check if stream is already live
      await this.checkStreamStatus();
      
      console.log('[ViewerManager] Stream manager initialized');
    } catch (error) {
      console.error('[ViewerManager] Initialization error:', error);
      this.onErrorCallback?.('Failed to initialize stream manager');
    }
  }

  /**
   * Setup signaling channel
   */
  private async setupSignalingChannel(): Promise<void> {
    this.channel = this.supabase.channel(`stream-signal-${this.roomCode}`, {
      config: {
        broadcast: { self: false },
      },
    });

    this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      this.handleSignal(payload as SignalMessage);
    });

    await this.channel.subscribe();
    console.log('[ViewerManager] Signaling channel setup complete');
  }

  /**
   * Check current stream status
   */
  private async checkStreamStatus(): Promise<void> {
    const { data: stream } = await this.supabase
      .from('streams')
      .select('status')
      .eq('id', this.streamId)
      .single();

    if (stream?.status === 'live') {
      console.log('[ViewerManager] Stream is already live, joining immediately');
      this.onIsStreamLiveCallback?.(true);
      setTimeout(() => this.joinStream(), 500); // Small delay to ensure channel is ready
    } else if (stream?.status === 'ended') {
      console.log('[ViewerManager] Stream has ended');
      this.onErrorCallback?.('This stream has ended');
    } else {
      console.log('[ViewerManager] Stream not live yet, waiting for host');
    }
  }

  /**
   * Handle incoming signals
   */
  private async handleSignal(message: SignalMessage): Promise<void> {
    if (message.to && message.to !== this.viewerId) return;

    console.log('[ViewerManager] Received signal:', message.type);

    switch (message.type) {
      case 'offer':
        await this.handleOffer(message.payload as RTCSessionDescriptionInit);
        break;

      case 'answer':
        await this.handleAnswer(message.payload as RTCSessionDescriptionInit);
        break;

      case 'ice-candidate':
        await this.connectionManager.addIceCandidate(message.payload as RTCIceCandidateInit);
        break;

      case 'stream-start':
        console.log('[ViewerManager] Stream started');
        this.onIsStreamLiveCallback?.(true);
        this.onErrorCallback?.(null);
        setTimeout(() => this.joinStream(), 1000);
        break;

      case 'stream-end':
        console.log('[ViewerManager] Stream ended');
        this.onIsStreamLiveCallback?.(false);
        this.onIsConnectedCallback?.(false);
        this.onRemoteStreamCallback?.(null as any);
        break;

      case 'stream-pause':
        console.log('[ViewerManager] Stream paused');
        break;

      case 'stream-resume':
        console.log('[ViewerManager] Stream resumed');
        break;

      case 'track-toggle':
        const payload = message.payload as { video?: boolean; audio?: boolean };
        if (payload.video !== undefined) {
          this.onHostVideoEnabledCallback?.(payload.video);
        }
        if (payload.audio !== undefined) {
          this.onHostAudioEnabledCallback?.(payload.audio);
        }
        break;
    }
  }

  /**
   * Handle incoming offer
   */
  private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    try {
      console.log('[ViewerManager] Handling offer');
      const answer = await this.connectionManager.handleOffer(offer);
      
      if (answer) {
        this.sendSignal({
          type: 'answer',
          from: this.viewerId,
          to: 'host',
          payload: answer,
        });
      }
    } catch (error) {
      console.error('[ViewerManager] Error handling offer:', error);
      this.onErrorCallback?.('Failed to connect to stream');
    }
  }

  /**
   * Handle incoming answer
   */
  private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    try {
      console.log('[ViewerManager] Handling answer');
      await this.connectionManager.handleAnswer(answer);
    } catch (error) {
      console.error('[ViewerManager] Error handling answer:', error);
      this.onErrorCallback?.('Failed to establish connection');
    }
  }

  /**
   * Join the stream
   */
  joinStream(): void {
    console.log('[ViewerManager] Joining stream');
    
    this.sendSignal({
      type: 'viewer-join',
      from: this.viewerId,
      to: 'host',
      viewerName: this.viewerName,
    });
  }

  /**
   * Leave the stream
   */
  leaveStream(): void {
    console.log('[ViewerManager] Leaving stream');
    
    this.sendSignal({
      type: 'viewer-leave',
      from: this.viewerId,
      to: 'host',
    });

    this.connectionManager.close();
  }

  /**
   * Send a signal through the signaling channel
   */
  private sendSignal(signal: SignalMessage): void {
    if (!this.channel) {
      console.error('[ViewerManager] No signaling channel available');
      return;
    }

    this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: signal,
    });
  }

  /**
   * Get connection state
   */
  getConnectionState(): string {
    return this.connectionManager.getConnectionState();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  /**
   * Set state callbacks
   */
  setOnRemoteStream(callback: (stream: MediaStream) => void): void {
    this.onRemoteStreamCallback = callback;
  }

  setOnIsConnected(callback: (connected: boolean) => void): void {
    this.onIsConnectedCallback = callback;
  }

  setOnIsStreamLive(callback: (live: boolean) => void): void {
    this.onIsStreamLiveCallback = callback;
  }

  setOnError(callback: (error: string | null) => void): void {
    this.onErrorCallback = callback;
  }

  setOnHostVideoEnabled(callback: (enabled: boolean) => void): void {
    this.onHostVideoEnabledCallback = callback;
  }

  setOnHostAudioEnabled(callback: (enabled: boolean) => void): void {
    this.onHostAudioEnabledCallback = callback;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    console.log('[ViewerManager] Cleaning up resources');
    
    this.leaveStream();
    
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    
    this.connectionManager.close();
  }
}
