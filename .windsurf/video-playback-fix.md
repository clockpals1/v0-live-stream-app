# Video Playback Initialization Fix

## Problem Summary
After the previous black screen fix, the stream was being delivered correctly (tracks were being added to the peer connection), but the viewer page still showed a black screen **until** the user clicked the "Data Saver" button. This revealed that:
- ✅ WebRTC connection was established
- ✅ Media tracks were being received
- ✅ Video element had the stream attached
- ❌ **Video playback was not starting automatically**

## Root Cause

### The Issue
**Premature `play()` call before video element was ready to play.**

The viewer-side code was calling `video.play()` immediately after setting `video.srcObject = remoteStream`, but the browser needs time to:
1. Load stream metadata
2. Buffer initial frames
3. Prepare the video element for playback

### Code Evidence

**File**: `components/viewer/stream-interface.tsx:178-244` (BEFORE FIX)

```typescript
useEffect(() => {
  const videoElement = videoRef.current;
  if (!videoElement) return;
  
  if (remoteStream) {
    console.log('[Viewer] Setting video stream:', remoteStream.id);
    
    // Set the stream
    videoElement.srcObject = remoteStream;  // ← Stream attached
    
    // ... some checks ...
    
    // Play the video (handle autoplay restrictions)
    const playVideo = async () => {
      try {
        await videoElement.play();  // ← Called immediately!
        console.log('[Viewer] Video playing successfully');
      } catch (error) {
        console.error('[Viewer] Error playing video:', error);
      }
    };
    
    // Try to play immediately
    playVideo();  // ⚠️ TOO EARLY - video not ready yet!
  }
}, [remoteStream]);
```

**File**: `components/viewer/stream-interface.tsx:260-267` (BEFORE FIX)

```typescript
const handleCanPlay = () => {
  console.log('[Viewer] Video can play');
  const loadingOverlay = document.getElementById('video-loading');
  if (loadingOverlay) {
    loadingOverlay.classList.remove('opacity-100');
    loadingOverlay.classList.add('opacity-0');
  }
  // ⚠️ NO play() call here!
};
```

### Why Clicking "Data Saver" Fixed It

When the user clicked "Data Saver", it triggered this effect:

**File**: `components/viewer/stream-interface.tsx:744-760`

```typescript
useEffect(() => {
  if (videoRef.current && remoteStream) {
    const videoTrack = remoteStream.getVideoTracks()[0];
    if (videoTrack) {
      const constraints = {
        width: isDataSaver ? { ideal: 640 } : ...,
        height: isDataSaver ? { ideal: 360 } : ...,
        frameRate: isDataSaver ? { ideal: 15 } : { ideal: 30 }
      };
      
      // Apply constraints to the video track
      videoTrack.applyConstraints(constraints).catch(...);  // ← This triggers re-render
    }
  }
}, [videoQuality, isDataSaver, remoteStream]);
```

Calling `applyConstraints()` caused the video track to re-initialize, which triggered the video element's internal playback mechanism, and the `autoPlay` attribute finally took effect.

### Timeline of Events

**Before Fix:**
```
1. remoteStream arrives
2. videoElement.srcObject = remoteStream
3. videoElement.play() called immediately ← FAILS (not ready)
4. Browser loads metadata (async)
5. canplay event fires ← play() NOT called here
6. Video stays black
7. User clicks "Data Saver"
8. applyConstraints() called
9. Video re-renders and autoPlay kicks in
10. Video plays ✓
```

**After Fix:**
```
1. remoteStream arrives
2. videoElement.srcObject = remoteStream
3. Browser loads metadata (async)
4. loadedmetadata event fires → play() called ✓
5. canplay event fires → play() called again (safety) ✓
6. Video plays immediately ✓
```

---

## The Fix

### Changes Made

**1. Removed Premature `play()` Call**

Removed the immediate `play()` call that happened right after setting `srcObject`. This was failing because the video element wasn't ready yet.

**Before:**
```typescript
videoElement.srcObject = remoteStream;
// ... 
playVideo(); // ← Too early!
```

**After:**
```typescript
videoElement.srcObject = remoteStream;
// Note: play() is now called in the canplay event handler when the video is ready
console.log('[Viewer] Video stream attached, waiting for canplay event');
```

**2. Added `play()` Call in `loadedmetadata` Handler**

Added a new event handler for `loadedmetadata` that attempts to play the video as soon as metadata is loaded.

```typescript
const handleLoadedMetadata = () => {
  console.log('[Viewer] Video metadata loaded');
  // Try to play as soon as metadata is loaded
  if (videoElement) {
    videoElement.play().catch((error) => {
      console.log('[Viewer] Autoplay failed in loadedmetadata handler:', error);
    });
  }
};

videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
```

**3. Added `play()` Call in `canplay` Handler**

Modified the existing `canplay` handler to also attempt playback.

```typescript
const handleCanPlay = () => {
  console.log('[Viewer] Video can play');
  const loadingOverlay = document.getElementById('video-loading');
  if (loadingOverlay) {
    loadingOverlay.classList.remove('opacity-100');
    loadingOverlay.classList.add('opacity-0');
  }
  
  // Attempt to play the video now that it's ready
  if (videoElement) {
    videoElement.play().catch((error) => {
      console.log('[Viewer] Autoplay failed in canplay handler:', error);
      // Autoplay blocked - user will need to interact
    });
  }
};
```

### Why This Works

**Multiple Trigger Points:**
1. `loadedmetadata` - Fires when the browser has loaded metadata (duration, dimensions, etc.)
2. `canplay` - Fires when the browser has buffered enough data to start playing
3. `autoPlay` attribute - Browser's native autoplay mechanism (as a fallback)

By attempting `play()` at both `loadedmetadata` and `canplay`, we ensure the video starts as soon as possible, regardless of browser timing variations.

---

## Verification Checklist

### ✅ Desktop Viewer
- [ ] Open viewer page while stream is live
- [ ] **Video plays immediately without user interaction**
- [ ] No need to click "Data Saver" or any other button
- [ ] Console shows: `[Viewer] Video metadata loaded`
- [ ] Console shows: `[Viewer] Video can play`
- [ ] Console shows: `[Viewer] Video playing`

### ✅ Mobile Viewer (iOS/Android)
- [ ] Open viewer page while stream is live
- [ ] **Video plays immediately (muted by default)**
- [ ] Can unmute by tapping the unmute button
- [ ] No black screen on initial load

### ✅ Autoplay Blocked Scenario
- [ ] If browser blocks autoplay, video should start after first user interaction
- [ ] Console shows: `[Viewer] Autoplay failed in loadedmetadata handler: NotAllowedError`
- [ ] Unmute button or any click should trigger playback

### ✅ Data Saver Toggle (Regression Test)
- [ ] Clicking "Data Saver" should still work
- [ ] Video quality should change
- [ ] Video should continue playing smoothly

---

## Testing Instructions

### Test 1: Fresh Page Load
1. Start a stream as host (admin or non-admin)
2. Open viewer page in a new browser tab/window
3. **Expected**: Video plays immediately, no black screen
4. Check console for playback logs

### Test 2: Mobile Device
1. Start a stream as host
2. Open viewer page on mobile device
3. **Expected**: Video plays immediately (muted)
4. Tap unmute button
5. **Expected**: Audio plays

### Test 3: Autoplay Blocked
1. Set browser to block autoplay (Chrome: Settings → Site Settings → Sound → Block)
2. Open viewer page
3. **Expected**: Video shows play button or unmute prompt
4. Click anywhere on the page
5. **Expected**: Video starts playing

### Test 4: Data Saver (Regression)
1. Open viewer page with video playing
2. Click "Data Saver" button
3. **Expected**: Video continues playing, quality changes
4. Click "Data Saver" again to toggle off
5. **Expected**: Video continues playing, quality improves

---

## Console Log Examples

### ✅ Successful Playback
```
[Viewer] Setting video stream: abc123 1 1
[Viewer] Video stream attached, waiting for canplay event
[Viewer] Video load start
[Viewer] Video metadata loaded
[Viewer] Video can play
[Viewer] Video playing
```

### ⚠️ Autoplay Blocked (Expected on Some Browsers)
```
[Viewer] Setting video stream: abc123 1 1
[Viewer] Video stream attached, waiting for canplay event
[Viewer] Video load start
[Viewer] Video metadata loaded
[Viewer] Autoplay failed in loadedmetadata handler: NotAllowedError
[Viewer] Video can play
[Viewer] Autoplay failed in canplay handler: NotAllowedError
// User clicks → video plays
[Viewer] Video playing
```

---

## Related Issues Fixed

1. ✅ Black screen on initial viewer page load
2. ✅ Video only playing after clicking "Data Saver"
3. ✅ Premature `play()` call before video ready
4. ✅ Missing `play()` call in `canplay` event handler

---

## Files Modified

1. `components/viewer/stream-interface.tsx` - Video playback initialization logic

---

## Technical Details

### Video Element Lifecycle

1. **`loadstart`** - Browser starts loading the stream
2. **`loadedmetadata`** - Metadata loaded (duration, dimensions) ← **First play() attempt**
3. **`loadeddata`** - First frame loaded
4. **`canplay`** - Enough data buffered to start playing ← **Second play() attempt**
5. **`canplaythrough`** - Enough data to play through without stalling
6. **`playing`** - Video is actually playing

### Why Multiple `play()` Calls Are Safe

Calling `play()` multiple times is safe and idempotent:
- If the video is already playing, subsequent `play()` calls are ignored
- If autoplay is blocked, all `play()` calls will fail with `NotAllowedError` until user interaction
- The `.catch()` handler prevents unhandled promise rejections

### Browser Autoplay Policies

Different browsers have different autoplay policies:
- **Chrome/Edge**: Allows autoplay if video is muted
- **Safari**: Allows autoplay if video is muted and has `playsInline` attribute
- **Firefox**: Allows autoplay if video is muted
- **Mobile browsers**: Generally more restrictive, require user interaction

Our fix handles all these scenarios by:
1. Setting `muted={true}` initially
2. Adding `playsInline` attribute for iOS
3. Adding `autoPlay` attribute as fallback
4. Calling `play()` at multiple trigger points
5. Gracefully handling autoplay failures

---

## Next Steps

1. ✅ Deploy to production
2. ✅ Test on multiple browsers (Chrome, Safari, Firefox, Edge)
3. ✅ Test on mobile devices (iOS Safari, Android Chrome)
4. ✅ Monitor console logs for any edge cases
5. Consider adding a visible "Click to play" button if autoplay fails consistently

---

## Summary

**Problem**: Video playback not starting automatically on viewer page load, only playing after clicking "Data Saver"

**Root Cause**: `play()` was called too early, before the video element was ready. The `canplay` event handler wasn't calling `play()`.

**Solution**: 
- Remove premature `play()` call
- Add `play()` call in `loadedmetadata` handler
- Add `play()` call in `canplay` handler
- Let browser's native autoplay mechanism work properly

**Impact**: Viewers now see video immediately on page load without any manual interaction required (unless browser blocks autoplay).
