# Analysis: Camera/Microphone Permission & Co-host Issues

## Problem Summary
1. Camera/microphone access failed error on host stream interface
2. Co-host list not showing beside chat
3. Co-host status not clearly signaled
4. Non-admin host camera/audio quality issues
5. Role logic (host/co-host/admin) needs verification

---

## Current Architecture Analysis

### 1. Media Initialization Flow

#### `useHostStream` (Admin/Primary Host)
**Location**: `lib/webrtc/use-host-stream.ts:43-80`

**Flow**:
```
initializeMedia() → tries 3 constraint levels → sets mediaStreamRef → returns stream
```

**Constraint Levels**:
1. Ideal: 1280x720@24fps + full audio processing
2. Fallback 1: 640x480 + basic audio
3. Fallback 2: `{video: true, audio: true}`

**Error Handling**:
- Sets error state: "Camera/microphone access failed. Please allow permissions and reload."
- Throws error on final attempt failure

**Called From**: `components/host/stream-interface.tsx:169`
```typescript
const mediaStreamResult = await initializeMedia('environment');
```

**Issue**: Error is set in hook state but may not be displayed prominently in UI.

---

#### `useCohostStream` (Co-host/Non-admin Host)
**Location**: `lib/webrtc/use-cohost-stream.ts:66-124`

**Flow**:
```
initializeMedia() → stops existing tracks → getUserMedia(HOST_MEDIA_CONSTRAINTS) → 
  if no audio → retry audio separately → merge tracks → updateStatus("ready")
```

**Key Differences from useHostStream**:
1. **No fallback constraints** - uses `HOST_MEDIA_CONSTRAINTS` directly
2. **Separate audio retry** - iOS/Android workaround for silent mic permission denial
3. **Status update** - broadcasts "ready" status to director panel
4. **Track replacement** - if viewers already connected, replaces their tracks

**Called From**: `components/host/cohost-stream-interface.tsx:96`
```typescript
const s = await initializeMedia("environment");
```

**Issue**: No progressive fallback like `useHostStream` has. If `HOST_MEDIA_CONSTRAINTS` fails, it throws immediately.

---

### 2. HOST_MEDIA_CONSTRAINTS

**Location**: `lib/webrtc/config.ts:61-73`

```typescript
{
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24 },
    facingMode: "environment",
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
}
```

**Problem**: These are "ideal" constraints, not "exact". They should work on most devices, but:
- Some low-end Android devices may reject the combined video+audio request
- iOS Safari may silently grant video but deny audio (hence the separate audio retry in `useCohostStream`)

---

### 3. UI Error Display

#### Host Stream Interface
**Location**: `components/host/stream-interface.tsx`

**Error State**: Comes from `useHostStream().error`

**Display Logic**: Need to check if error is shown prominently.

#### Cohost Stream Interface  
**Location**: `components/host/cohost-stream-interface.tsx`

**Error State**: Comes from `useCohostStream().error`

**Display Logic**: Need to check if error is shown prominently.

---

### 4. Co-host List Display

**Dashboard Query**: `components/host/dashboard-content.tsx:107-121`

```typescript
const { data } = await supabase
  .from("stream_participants")
  .select("id, slot_label, status, stream:streams(id, title, room_code, status)")
  .eq("host_id", host.id)
  .neq("status", "offline");
```

**Filters**:
- `host_id` = current host
- `status` != "offline"
- `stream.status` != "ended"

**State**: `cohostParticipants: CohostParticipant[]`

**Issue**: This data is loaded in dashboard but NOT passed to the stream interface. The stream interface has no access to co-host participant data.

---

### 5. Role Logic

#### Admin
- `is_admin: true` in hosts table
- Can create streams (`host_id` = admin's id)
- Can relay co-host streams via `relayStream()`
- Can switch between co-hosts via director panel

#### Host (Non-admin)
- `is_admin: false` or null
- Can be assigned to streams (`assigned_host_id`)
- Can create their own streams (`host_id`)
- **Cannot** relay other streams (no `relayStream` in `useCohostStream`)

#### Co-host
- Entry in `stream_participants` table
- `host_id` = the host who is co-hosting
- `stream_id` = the stream they're co-hosting for
- Uses `useCohostStream` hook
- Broadcasts to viewers via isolated signaling channel

**Role Combinations**:
- ✅ Admin can be a co-host (admin creates participant slot for themselves)
- ✅ Host can be a co-host (host creates participant slot for themselves)
- ✅ Host can also act as primary host on their own stream

---

## Root Cause Analysis

### Issue 1: Camera/Microphone Access Failed Error

**Root Cause**: 
1. `useCohostStream.initializeMedia()` has no fallback constraints
2. If `HOST_MEDIA_CONSTRAINTS` fails (e.g., device doesn't support 720p), it throws immediately
3. Error may not be displayed prominently in UI

**Evidence**:
- Screenshot shows "Camera/microphone access failed. Please allow permissions and reload."
- Video preview is visible (dark/blurry) suggesting camera DID initialize
- Error is likely stale from a previous failed attempt, or from the separate audio retry failing

**Fix Strategy**:
1. Add progressive fallback to `useCohostStream.initializeMedia()` (match `useHostStream`)
2. Ensure error UI is prominent and actionable
3. Add retry button

---

### Issue 2: Co-host List Not Showing

**Root Cause**:
- Dashboard loads `cohostParticipants` but doesn't pass it to stream interface
- Stream interface has no query for participants
- No UI component to display co-host list beside chat

**Fix Strategy**:
1. Query `stream_participants` in stream interface
2. Add UI section beside chat to show co-host list
3. Show join link for each co-host

---

### Issue 3: Co-host Status Not Clearly Signaled

**Root Cause**:
- No visual indicator in dashboard showing "You are currently co-hosting Stream X"
- Co-host participants are listed but not highlighted as "active"

**Fix Strategy**:
1. Add prominent badge/banner in dashboard when user is actively co-hosting
2. Highlight the stream they're co-hosting in the list
3. Show "Co-hosting" status in stream interface header

---

### Issue 4: Non-admin Host Camera/Audio Quality Issues

**Root Cause**:
- `useCohostStream` uses same `HOST_MEDIA_CONSTRAINTS` as admin
- No quality difference in constraints
- Possible issues:
  - Network conditions (TURN relay quality)
  - Separate audio retry failing silently
  - Track replacement logic during reconnect

**Fix Strategy**:
1. Add logging to track audio retry success/failure
2. Verify track replacement logic
3. Check if `updateStatus("ready")` is being called correctly

---

### Issue 5: Role Logic Verification

**Current State**: Role combinations are supported in data model but may have UI/UX gaps.

**Fix Strategy**:
1. Verify admin can create participant slot for themselves
2. Verify host can create participant slot for themselves  
3. Ensure UI clearly shows role context (admin vs host vs co-host)

---

## Proposed Fix Order

1. **Fix camera/microphone initialization** (highest priority)
   - Add fallback constraints to `useCohostStream`
   - Improve error UI display
   - Add retry button

2. **Fix co-host list display**
   - Query participants in stream interface
   - Add UI component beside chat
   - Show join links

3. **Fix co-host status signaling**
   - Add "Co-hosting" indicator in dashboard
   - Add "Co-hosting" badge in stream interface header

4. **Fix role logic clarity**
   - Verify all role combinations work
   - Add role badges in UI

5. **Fix non-admin camera/audio quality**
   - Add logging for audio retry
   - Verify track replacement
   - Test network conditions

---

## Files to Modify

1. `lib/webrtc/use-cohost-stream.ts` - Add fallback constraints
2. `components/host/cohost-stream-interface.tsx` - Improve error UI
3. `components/host/stream-interface.tsx` - Query participants, add co-host list UI
4. `components/host/dashboard-content.tsx` - Add co-hosting status indicator
5. `lib/webrtc/config.ts` - Possibly adjust constraints

---

## Next Steps

1. Read full error display logic in both stream interfaces
2. Implement fixes in order listed above
3. Test each fix before moving to next
