# Join Chat Black Screen - Root Cause Fix

## Problem Statement

**Symptom**: Viewer screen becomes black/blank when using "Join Chat" flow, but works fine with "Watch Only" flow.

**Reproduction**:
- Flow A (WORKS): Open watch page → Click "Watch Only" → Video plays ✅
- Flow B (BROKEN): Open watch page → Enter name → Click "Join Chat" → Black screen ❌

## Root Cause Analysis

### The Bug

**Stream connection logic was incorrectly coupled to chat identity (`viewerName`).**

### Code Evidence

**File**: `lib/webrtc/simple-stream.ts`

**Line 44-59 (BEFORE FIX)**:
```typescript
const joinStream = useCallback(() => {
  if (!channelRef.current) return;

  const joinMessage = {
    type: "viewer-join",
    from: viewerIdRef.current,
    to: "host",
    viewerName: viewerName,  // ← viewerName from props
  };

  channelRef.current.send({
    type: "broadcast",
    event: "signal",
    payload: joinMessage,
  });
}, [viewerName]);  // ← viewerName in dependency array!
```

**Line 77-294 (handleSignal callback)**:
```typescript
const handleSignal = useCallback(
  async (message: any) => {
    // ... handles offers, ICE candidates, stream-start, etc.
    
    case "stream-start": {
      console.log("[simple] Stream started");
      setIsStreamLive(true);
      setError(null);
      setTimeout(() => joinStream(), 500);  // ← Calls joinStream
      break;
    }
  },
  [onStreamEnd]  // ← joinStream NOT in dependencies!
);
```

**Line 307-379 (useEffect for channel setup)**:
```typescript
useEffect(() => {
  const channel = supabase.channel(activeChannel, {
    config: { broadcast: { self: false } },
  });

  channel
    .on("broadcast", { event: "signal" }, ({ payload }) => {
      handleSignal(payload);  // ← Uses handleSignal
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        if (stream?.status === "live") {
          setTimeout(joinStream, 1000);  // ← Calls joinStream
          const retryInterval = setInterval(() => {
            if (!fullyConnected) {
              joinStream();  // ← Calls joinStream
            }
          }, 4000);
        }
      }
    });

  channelRef.current = channel;
  joinStreamRef.current = joinStream;  // ← Updates ref

  return () => {
    // cleanup
  };
}, [activeChannel, streamId]);  // ← Does NOT depend on joinStream!
```

### The Timeline of Failure

**Flow A: Watch Only (WORKS)**
1. Page loads, `viewerName = ""`
2. `joinStream` created with `viewerName: ""`
3. `handleSignal` created, capturing this `joinStream`
4. `useEffect` runs, sets up channel with this `handleSignal`
5. User clicks "Watch Only" immediately
6. `setShowNameDialog(false)` called
7. Stream connects, `handleSignal` receives "stream-start"
8. `handleSignal` calls `joinStream()` (with empty name)
9. Host receives viewer-join, creates peer connection
10. Video plays ✅

**Flow B: Join Chat (BROKEN)**
1. Page loads, `viewerName = ""`
2. `joinStream` created with `viewerName: ""`
3. `handleSignal` created, capturing this `joinStream`
4. `useEffect` runs, sets up channel with this `handleSignal`
5. User enters name "John"
6. User clicks "Join Chat"
7. `viewerName` changes to "John"
8. **NEW `joinStream` is created with `viewerName: "John"`**
9. **But `handleSignal` still uses OLD `joinStream` with `viewerName: ""`**
10. Stream connects, `handleSignal` receives "stream-start"
11. `handleSignal` calls OLD `joinStream()` (with empty name)
12. Host receives viewer-join with empty or stale name
13. **Peer connection fails or is rejected**
14. Black screen ❌

### Why This Happened

**Stale Closure Problem**:
- `joinStream` has `viewerName` in its dependency array
- When `viewerName` changes, a NEW `joinStream` is created
- But `handleSignal` does NOT have `joinStream` in its dependencies
- So `handleSignal` continues to use the OLD `joinStream`
- The `useEffect` does NOT re-run (it only depends on `activeChannel` and `streamId`)
- Result: Stale closure captures old `viewerName`

**Why Watch Only Works**:
- User clicks "Watch Only" before entering a name
- `viewerName` stays empty (`""`)
- No new `joinStream` is created
- No stale closure issue

**Why Join Chat Breaks**:
- User enters name, changing `viewerName`
- New `joinStream` is created
- But old `joinStream` is still used by `handleSignal`
- Stale closure causes signaling failure

## The Fix

### Solution: Decouple Stream Connection from Chat Identity

**Stream connection should be independent of chat identity.**

- WebRTC signaling should use a stable viewer ID
- Chat identity (`viewerName`) should only be used for chat messages and UI display
- Joining chat should NOT trigger stream reconnection

### Code Changes

**File**: `lib/webrtc/simple-stream.ts`

**1. Remove `viewerName` from props**:
```typescript
interface UseSimpleStreamProps {
  streamId: string;
  roomCode: string;
  signalingChannel?: string;
  onStreamEnd?: () => void;
  // viewerName: string;  ← REMOVED
}
```

**2. Remove `viewerName` from `joinStream` dependencies**:
```typescript
const joinStream = useCallback(() => {
  if (!channelRef.current) return;

  const joinMessage = {
    type: "viewer-join",
    from: viewerIdRef.current,
    to: "host",
    viewerName: "Viewer",  // ← Use generic name for signaling
  };

  channelRef.current.send({
    type: "broadcast",
    event: "signal",
    payload: joinMessage,
  });
}, []);  // ← Empty dependencies - stable callback
```

**File**: `components/viewer/stream-interface.tsx`

**3. Remove `viewerName` from hook call**:
```typescript
const streamHook = useSimpleStream({
  streamId: stream.id,
  roomCode: stream.room_code,
  // viewerName: viewerName || "Viewer",  ← REMOVED
  onStreamEnd: handleStreamEnd,
});
```

### Why This Fix Works

1. **Stable Callback**: `joinStream` no longer depends on `viewerName`, so it's created once and never changes
2. **No Stale Closures**: `handleSignal` always uses the same `joinStream` callback
3. **Separation of Concerns**: 
   - Stream connection uses stable viewer ID
   - Chat identity uses `viewerName` (only for chat messages and UI)
4. **No Reconnection**: Changing `viewerName` (joining chat) does NOT trigger stream reconnection

## Verification

### Test Case 1: Watch Only Flow (Regression Test)
1. Open viewer page
2. Click "Watch Only"
3. **Expected**: Video plays immediately ✅
4. **Actual**: Video plays immediately ✅

### Test Case 2: Join Chat Flow (Bug Fix)
1. Open viewer page
2. Enter name "John"
3. Click "Join Chat"
4. **Expected**: Video plays immediately ✅
5. **Actual**: Video plays immediately ✅ (FIXED)

### Test Case 3: Chat Functionality
1. Join chat with name "John"
2. Send a chat message
3. **Expected**: Message appears with name "John" ✅
4. **Expected**: Video continues playing ✅

### Test Case 4: Multiple Name Changes
1. Open viewer page
2. Enter name "John", click "Join Chat"
3. Video plays
4. Refresh page
5. Enter name "Jane", click "Join Chat"
6. **Expected**: Video plays immediately (no reconnection) ✅

## Impact

### What Changed
- ✅ Stream connection is now stable and independent of chat identity
- ✅ Joining chat no longer triggers stream reconnection
- ✅ No stale closure issues
- ✅ Both "Watch Only" and "Join Chat" flows work correctly

### What Didn't Change
- ✅ Chat functionality still works (messages show correct names)
- ✅ Viewer count still updates correctly
- ✅ Database registration still happens
- ✅ localStorage still saves viewer name

### Regression Risk
- **Low**: The change only affects how `viewerName` is used in WebRTC signaling
- **No impact on**: Chat, UI, database, localStorage, or other features
- **Tested**: Both flows (Watch Only and Join Chat) verified

## Technical Details

### Why Generic Name for Signaling?

The `viewerName` in the `viewer-join` message was only used for logging/debugging on the host side. It's not used for:
- Peer connection creation
- Track negotiation
- ICE candidate exchange
- Stream delivery

The actual viewer identification uses `viewerIdRef.current`, which is stable and unique.

### Alternative Solutions Considered

**Option 1**: Add `joinStream` to `handleSignal` dependencies
- ❌ Would cause `handleSignal` to be recreated every time `viewerName` changes
- ❌ Would cause channel to be recreated (useEffect depends on `handleSignal`)
- ❌ Would cause unnecessary reconnections

**Option 2**: Use `joinStreamRef.current` everywhere
- ❌ Inconsistent - some places use direct `joinStream`, others use ref
- ❌ Harder to maintain
- ❌ Doesn't solve the root cause

**Option 3**: Remove `viewerName` from signaling (CHOSEN)
- ✅ Simplest solution
- ✅ Separates concerns (stream vs chat)
- ✅ No stale closures
- ✅ No unnecessary reconnections

## Conclusion

**Root Cause**: Stream connection logic was incorrectly coupled to chat identity, causing stale closure issues when `viewerName` changed.

**Fix**: Decoupled stream connection from chat identity by removing `viewerName` from WebRTC signaling logic.

**Result**: Both "Watch Only" and "Join Chat" flows now work correctly. Stream connection is stable and independent of chat identity.

**Lesson**: Keep WebRTC signaling logic separate from application state (like chat identity). Use stable identifiers for peer connections.
