# Diagnostic Plan for Black Screen Issue

## Current Situation
- User reports black/blank screen when viewing stream
- Issue persists across multiple attempted fixes
- Core streaming functionality is broken

## Hypothesis
Based on code analysis, possible causes:

### 1. **Host has no media stream when viewer joins**
- `mediaStreamRef.current` is null when `createPeerConnection` is called
- Host creates peer connection but adds NO tracks
- Viewer receives empty stream → black screen

### 2. **Timing/Race Condition**
- Viewer joins immediately after stream-start signal
- Host's media not fully initialized yet
- Peer connection created with no tracks

### 3. **Track State Issues**
- Tracks exist but are in wrong state (muted, ended, etc.)
- Tracks not properly enabled
- Browser autoplay blocking

## Diagnostic Steps

### Step 1: Add Comprehensive Logging
Add logging to track:
1. When host media is initialized
2. When viewer-join is received
3. What tracks are added to peer connection
4. What tracks viewer receives
5. Video element state

### Step 2: Test Scenarios
1. **Admin host + viewer**: Does it work?
2. **Non-admin host + viewer**: Does it work?
3. **Timing test**: Viewer joins immediately vs after 5 seconds

### Step 3: Console Log Analysis
Collect logs from both host and viewer:
- Host logs: Media init, track addition, peer creation
- Viewer logs: Track reception, stream attachment, video play

## Expected vs Actual

### Expected Flow
1. Host clicks "Start Stream"
2. Host initializes media (camera/mic)
3. Host verifies tracks exist
4. Host updates DB to "live"
5. Host broadcasts "stream-start"
6. Viewer receives "stream-start"
7. Viewer sends "viewer-join"
8. Host receives "viewer-join"
9. Host creates peer connection
10. Host adds tracks to peer connection
11. Host creates offer
12. Viewer receives offer
13. Viewer creates answer
14. ICE negotiation
15. Viewer receives tracks via ontrack
16. Viewer sets remoteStream
17. Viewer attaches stream to video element
18. Video plays

### Actual Flow (Suspected)
1-7. Same as expected
8. Host receives "viewer-join"
9. Host creates peer connection
10. **Host has no mediaStreamRef.current** ← PROBLEM
11. **No tracks added** ← PROBLEM
12. Offer created with no tracks
13. Viewer receives offer with no tracks
14. ICE negotiation succeeds
15. **Viewer receives NO tracks** ← PROBLEM
16. **remoteStream is empty or null** ← PROBLEM
17. Video element has no stream
18. Black screen

## Quick Test
Add this logging to host's createPeerConnection:

```typescript
const sourceStream = activeRelayStreamRef.current ?? mediaStreamRef.current;
console.log('[DIAGNOSTIC] createPeerConnection called:', {
  viewerId,
  hasMediaStream: !!mediaStreamRef.current,
  hasRelayStream: !!activeRelayStreamRef.current,
  hasSourceStream: !!sourceStream,
  mediaStreamTracks: mediaStreamRef.current?.getTracks().length ?? 0,
  relayStreamTracks: activeRelayStreamRef.current?.getTracks().length ?? 0,
  sourceStreamTracks: sourceStream?.getTracks().length ?? 0,
});
```

Add this to viewer's ontrack:

```typescript
pc.ontrack = (event) => {
  console.log('[DIAGNOSTIC] ontrack fired:', {
    kind: event.track.kind,
    enabled: event.track.enabled,
    readyState: event.track.readyState,
    hasStreams: event.streams.length > 0,
    streamId: event.streams[0]?.id,
    streamTracks: event.streams[0]?.getTracks().length ?? 0,
  });
  // ... rest of handler
};
```

## Next Steps
1. Add diagnostic logging
2. Test with admin host
3. Test with non-admin host
4. Collect console logs
5. Analyze logs to find exact failure point
6. Implement targeted fix
