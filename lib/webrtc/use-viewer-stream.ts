"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ViewerStreamManager } from "./viewer-stream-manager";

interface UseViewerStreamProps {
  streamId: string;
  roomCode: string;
  viewerName: string;
  onStreamEnd?: () => void;
}

export function useViewerStream({ streamId, roomCode, viewerName, onStreamEnd }: UseViewerStreamProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostVideoEnabled, setHostVideoEnabled] = useState(true);
  const [hostAudioEnabled, setHostAudioEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [isStreamPaused, setIsStreamPaused] = useState(false);

  const streamManagerRef = useRef<ViewerStreamManager | null>(null);

  // Initialize stream manager
  useEffect(() => {
    const initializeStreamManager = async () => {
      try {
        console.log('[useViewerStream] Initializing stream manager');
        
        const streamManager = new ViewerStreamManager({
          streamId,
          roomCode,
          viewerName,
          onStreamEnd,
          onStreamStart: () => {
            console.log('[useViewerStream] Stream started');
            setIsStreamLive(true);
            setError(null);
          },
          onConnectionChange: (connected) => {
            console.log('[useViewerStream] Connection changed:', connected);
            setIsConnected(connected);
          },
        });

        // Set up callbacks
        streamManager.setOnRemoteStream((stream) => {
          console.log('[useViewerStream] Remote stream received');
          setRemoteStream(stream);
        });

        streamManager.setOnIsConnected((connected) => {
          setIsConnected(connected);
        });

        streamManager.setOnIsStreamLive((live) => {
          setIsStreamLive(live);
        });

        streamManager.setOnError((error) => {
          setError(error);
        });

        streamManager.setOnHostVideoEnabled((enabled) => {
          setHostVideoEnabled(enabled);
        });

        streamManager.setOnHostAudioEnabled((enabled) => {
          setHostAudioEnabled(enabled);
        });

        streamManager.setOnIsStreamPaused((paused) => {
          setIsStreamPaused(paused);
        });

        // Initialize the stream manager
        await streamManager.initialize();
        
        streamManagerRef.current = streamManager;
        console.log('[useViewerStream] Stream manager initialized successfully');
      } catch (error) {
        console.error('[useViewerStream] Failed to initialize stream manager:', error);
        setError('Failed to initialize stream connection');
      }
    };

    initializeStreamManager();

    return () => {
      console.log('[useViewerStream] Cleaning up stream manager');
      if (streamManagerRef.current) {
        streamManagerRef.current.cleanup();
        streamManagerRef.current = null;
      }
    };
  }, [streamId, roomCode, viewerName, onStreamEnd]);

  // Update connection state
  useEffect(() => {
    if (streamManagerRef.current) {
      setConnectionState(streamManagerRef.current.getConnectionState());
    }
  }, [isConnected]);

  // Join stream function
  const joinStream = useCallback(() => {
    if (streamManagerRef.current) {
      streamManagerRef.current.joinStream();
    }
  }, []);

  // Leave stream function
  const leaveStream = useCallback(() => {
    if (streamManagerRef.current) {
      streamManagerRef.current.leaveStream();
    }
  }, []);

  // Get connection state
  const getConnectionState = useCallback(() => {
    return streamManagerRef.current?.getConnectionState() || 'unknown';
  }, []);

  return {
    isConnected,
    remoteStream,
    isStreamLive,
    error,
    hostVideoEnabled,
    hostAudioEnabled,
    connectionState,
    isStreamPaused,
    joinStream,
    leaveStream,
    getConnectionState,
  };
}
