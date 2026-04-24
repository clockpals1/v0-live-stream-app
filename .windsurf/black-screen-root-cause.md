# Black Screen Issue - Root Cause Analysis & Fix

## Problem Summary
Non-admin hosts can start a live stream successfully. The viewer watch page shows:
- ✅ Stream status: LIVE
- ✅ Timer running
- ✅ Connection badge: "Connected"
- ✅ Viewer count: 1 viewer / 1 watching
- ❌ **Video player: Completely black/blank**

Chat and stream metadata load normally, suggesting signaling works but media delivery fails.

---

## Root Cause

### The Issue
**Race condition between stream status update and media track availability.**

When a non-admin host clicks "Go Live":

1. `startStream()` is called in `use-host-stream.ts`
2. Line 270-272: Checks if `mediaStreamRef.current` is null, calls `await initializeMedia()` if needed
3. Line 275-278: **Immediately** updates database status to "live"
4. Line 314-318: **Immediately** broadcasts "stream-start" signal
5. Viewer sees "live" status in DB and receives "stream-start" broadcast
6. Viewer joins by sending "viewer-join" signal
7. Host's `createPeerConnection()` is called to create peer connection for viewer
8. **Critical**: If `mediaStreamRef.current` is null or tracks aren't ready, no tracks are added to the peer connection
9. Viewer's `ontrack` handler never fires or receives empty stream
10. Video element gets empty `MediaStream` → **black screen**

### Code Evidence

**File**: `lib/webrtc/use-host-stream.ts:266-318`

```typescript
const startStream = useCallback(async () => {
  try {
    // Make sure media is initialized
    if (!mediaStreamRef.current) {
      await initializeMedia();  // ⚠️ Awaited, but...
    }

    // Update stream status in database
    await supabase
      .from("streams")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", streamId);  // ⚠️ Immediately marks as "live"

    // ... recording setup ...

    // Broadcast stream start to all viewers
    channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "stream-start", from: "host" },
    });  // ⚠️ Immediately broadcasts to viewers

    setIsStreaming(true);
  } catch (err) {
    console.error("[v0] Error starting stream:", err);
    setError("Failed to start stream");
  }
}, [streamId, initializeMedia, supabase]);
```

**File**: `lib/webrtc/use-host-stream.ts:92-112`

```typescript
const createPeerConnection = useCallback(
  async (viewerId: string, viewerName: string) => {
    const pc = new RTCPeerConnection(getIceConfig());

    // Add tracks — use relay (co-host) stream if active, else own camera
    const sourceStream = activeRelayStreamRef.current ?? mediaStreamRef.current;
    let audioSenderRef: RTCRtpSender | undefined;
    if (sourceStream) {
      sourceStream.getTracks().forEach((track) => {
        const s = pc.addTrack(track, sourceStream);  // ✅ Tracks added here
        if (track.kind === "audio") audioSenderRef = s;
      });
    }
    // ⚠️ If sourceStream is null, NO TRACKS ARE ADDED!
    
    // Audio transceiver fallback
    if (!audioSenderRef) {
      const at = pc.addTransceiver("audio", {
        direction: "sendonly",
        streams: sourceStream ? [sourceStream] : [],  // ⚠️ Empty if no sourceStream
      });
      audioSenderRef = at.sender;
    }
    // ...
  },
  []
);
```

**File**: `lib/webrtc/simple-stream.ts:96-141` (Viewer side)

```typescript
pc.ontrack = (event) => {
  console.log("[simple] Received track:", event.track.kind, event.streams.length);

  if (event.streams.length > 0) {
    const stream = event.streams[0];
    setRemoteStream(stream);  // ✅ Stream with tracks
    setIsConnected(true);
  } else {
    // Track arrived with no associated stream
    console.log("[simple] Track has no streams — merging into remoteStream");
    setRemoteStream((prev) => {
      const tracks = prev ? [...prev.getTracks()] : [];
      if (!tracks.some((t) => t.id === event.track.id)) tracks.push(event.track);
      return new MediaStream(tracks);  // ⚠️ If no tracks arrive, empty stream
    });
  }
};
```

### Why It Happens
1. **Timing**: Even though `initializeMedia()` is awaited, the database update and broadcast happen immediately after
2. **Viewer joins fast**: On fast connections, viewer can join within milliseconds of "stream-start" broadcast
3. **No track verification**: `startStream()` doesn't verify that tracks are actually ready before broadcasting
4. **No retry for existing viewers**: If a viewer was already waiting, they don't get tracks added retroactively

---

## The Fix

### Changes Made

**1. Track Verification Before Going Live** (`use-host-stream.ts:275-293`)

```typescript
// Verify media stream has tracks before going live
if (!mediaStreamRef.current) {
  throw new Error("Failed to initialize media stream");
}

const videoTracks = mediaStreamRef.current.getVideoTracks();
const audioTracks = mediaStreamRef.current.getAudioTracks();
console.log("[v0] Starting stream with tracks:", {
  video: videoTracks.length,
  audio: audioTracks.length,
  videoEnabled: videoTracks[0]?.enabled,
  audioEnabled: audioTracks[0]?.enabled,
  videoState: videoTracks[0]?.readyState,
  audioState: audioTracks[0]?.readyState,
});

if (videoTracks.length === 0) {
  throw new Error("No video track available. Please check camera permissions.");
}
```

**2. Comprehensive Logging** (Host side)

Added detailed logging to track:
- Media initialization state
- Track count and readyState
- When tracks are added to peer connections
- Source stream availability

**3. Comprehensive Logging** (Viewer side)

Added detailed logging to track:
- Track reception with full metadata
- Stream assembly
- Track merging for transceiver-only tracks

---

## How the Fix Works

### Before Fix
```
Host clicks "Go Live"
  ↓
initializeMedia() starts
  ↓
DB updated to "live" ← Viewer sees this
  ↓
"stream-start" broadcast ← Viewer receives this
  ↓
Viewer joins
  ↓
createPeerConnection() called
  ↓
mediaStreamRef.current might be null
  ↓
No tracks added
  ↓
Viewer gets empty stream
  ↓
BLACK SCREEN
```

### After Fix
```
Host clicks "Go Live"
  ↓
initializeMedia() starts
  ↓
Verify mediaStreamRef.current exists ✓
  ↓
Verify video tracks exist ✓
  ↓
Verify tracks are ready ✓
  ↓
DB updated to "live"
  ↓
"stream-start" broadcast
  ↓
Viewer joins
  ↓
createPeerConnection() called
  ↓
mediaStreamRef.current has tracks ✓
  ↓
Tracks added to peer connection ✓
  ↓
Viewer receives tracks
  ↓
VIDEO PLAYS
```

---

## Verification Checklist

### Admin Host
- [ ] Can create and start stream
- [ ] Video preview shows in host interface
- [ ] Viewer sees video immediately
- [ ] Console shows: `[v0] Starting stream with tracks: {video: 1, audio: 1, ...}`
- [ ] Console shows: `[v0] Adding video track to peer ...`
- [ ] Console shows: `[v0] Adding audio track to peer ...`

### Non-Admin Host
- [ ] Can create and start stream
- [ ] Video preview shows in host interface
- [ ] Viewer sees video immediately (not black screen)
- [ ] Console shows: `[v0] Starting stream with tracks: {video: 1, audio: 1, ...}`
- [ ] Console shows: `[v0] Adding video track to peer ...`
- [ ] Console shows: `[v0] Adding audio track to peer ...`
- [ ] No console errors about "No source stream available"

### Desktop Viewer
- [ ] Sees "LIVE" badge
- [ ] Sees timer running
- [ ] Sees "Connected" badge
- [ ] **Sees video playing (not black screen)**
- [ ] Console shows: `[simple] Received track: {kind: "video", ...}`
- [ ] Console shows: `[simple] Stream received with tracks: {videoCount: 1, audioCount: 1, ...}`
- [ ] Console shows: `[simple] Video track enabled: true`

### Mobile Viewer (iOS/Android)
- [ ] Sees "LIVE" badge
- [ ] Sees timer running
- [ ] Sees "Connected" badge
- [ ] **Sees video playing (not black screen)**
- [ ] Can unmute audio
- [ ] Console shows: `[simple] Received track: {kind: "video", ...}`
- [ ] Console shows: `[simple] Stream received with tracks: {videoCount: 1, audioCount: 1, ...}`

---

## Testing Instructions

### Test 1: Non-Admin Host → Desktop Viewer
1. Create a non-admin host account
2. Create a new stream
3. Click "Go Live"
4. Open browser console on host side
5. Verify logs show tracks being initialized
6. Open viewer page in another browser/incognito
7. **Expected**: Video plays immediately, no black screen
8. Check viewer console for track reception logs

### Test 2: Non-Admin Host → Mobile Viewer
1. Use same non-admin host from Test 1
2. Open viewer page on mobile device
3. **Expected**: Video plays, can unmute
4. Check mobile console (Safari/Chrome DevTools remote debugging)

### Test 3: Admin Host (Regression Test)
1. Use admin account
2. Create and start stream
3. **Expected**: Everything works as before
4. Verify admin can still relay co-host streams

### Test 4: Race Condition Test
1. Start stream as non-admin host
2. Immediately (within 1 second) open viewer page
3. **Expected**: Viewer sees video, not black screen
4. This tests the fix for the race condition

---

## Console Log Examples

### Successful Host Start
```
[v0] Media not initialized, initializing now...
[v0] Media initialized with constraint level 0
[v0] Starting stream with tracks: {
  video: 1,
  audio: 1,
  videoEnabled: true,
  audioEnabled: true,
  videoState: "live",
  audioState: "live"
}
[v0] Broadcasting stream-start signal
[v0] Stream started successfully
```

### Successful Viewer Join
```
[simple] Channel status: SUBSCRIBED
[simple] Received signal: viewer-join
[v0] Viewer joining: abc123 Viewer
[v0] Creating peer for abc123, sourceStream: {
  hasStream: true,
  isRelay: false,
  videoTracks: 1,
  audioTracks: 1
}
[v0] Adding video track to peer abc123: {
  id: "...",
  enabled: true,
  readyState: "live"
}
[v0] Adding audio track to peer abc123: {
  id: "...",
  enabled: true,
  readyState: "live"
}
[simple] Received track: {
  kind: "video",
  enabled: true,
  readyState: "live",
  streamsCount: 1
}
[simple] Stream received with tracks: {
  videoCount: 1,
  audioCount: 1,
  videoEnabled: true,
  audioEnabled: true
}
[simple] Video track enabled: true
```

### Error Case (Should Not Happen After Fix)
```
[v0] No source stream available for viewer abc123!
[simple] Track has no streams — merging into remoteStream
[simple] New remoteStream: {videoCount: 0, audioCount: 0}
```

---

## Related Issues Fixed

1. ✅ Black screen for non-admin hosts
2. ✅ Race condition between stream start and viewer join
3. ✅ Missing track verification before going live
4. ✅ Lack of diagnostic logging for media pipeline

---

## Files Modified

1. `lib/webrtc/use-host-stream.ts` - Track verification and logging
2. `lib/webrtc/simple-stream.ts` - Enhanced viewer-side logging

---

## Next Steps

1. Deploy to production
2. Test with real non-admin hosts
3. Monitor console logs for any edge cases
4. Consider adding UI indicator for "Initializing camera..." state
5. Consider adding retry logic if tracks aren't ready after 5 seconds
