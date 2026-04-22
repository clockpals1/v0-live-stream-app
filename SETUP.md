# Isunday Stream Live - Setup Guide

## Overview
Isunday Stream Live is a fully functional live streaming platform built with Next.js, WebRTC, and Supabase. It allows hosts to stream from their phone camera and viewers to join via a simple link.

## Features
- **WebRTC Peer-to-Peer Streaming** - Direct connection between host and viewers (up to 50 viewers)
- **Phone Camera Support** - Stream directly from mobile device camera
- **Real-time Chat** - Live chat between host and viewers
- **Automatic Recording** - Streams are recorded and downloadable
- **Host Authentication** - Secure login system with password reset
- **Modern UI** - Beautiful, responsive design using shadcn/ui
- **Share Links** - Auto-generated room codes for easy sharing

## Quick Start

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd v0-live-stream-app
npm install
```

### 2. Set Up Supabase
1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to Settings > API and copy:
   - Project URL
   - Anon Key
   - Service Role Key
3. Run the database migrations in Supabase SQL Editor:
   - Copy contents of `supabase/migrations/001_create_streams_schema.sql`
   - Copy contents of `supabase/migrations/002_create_host_trigger.sql`
   - Execute both in order

### 3. Configure Environment Variables
Create `.env.local` file:
```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_MAX_VIEWERS=50

# Development
NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback
```

### 4. Run Development Server
```bash
npm run dev
```
Visit `http://localhost:3000`

## Host Account Setup

### Default Host Account
- **Email**: sunday@isunday.me
- **Password**: Ronkus123@

### First Time Setup
1. Go to `/auth/signup` and create the host account
2. Verify email if required
3. Login at `/auth/login`
4. You'll be redirected to the host dashboard

## How to Use

### For Hosts:
1. **Login** at `/auth/login`
2. **Create Stream** from dashboard
3. **Allow Camera/Microphone** permissions when prompted
4. **Share Link** with viewers
5. **Go Live** to start broadcasting
6. **End Stream** when finished (recording will be available for download)

### For Viewers:
1. **Open Link** shared by host
2. **Enter Name** to join chat (or watch anonymously)
3. **Enjoy Stream** with live chat functionality

## Deployment

### Vercel (Recommended)
1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Other Platforms
The app can be deployed to any platform that supports Next.js:
- Netlify
- Railway
- Digital Ocean
- Cloudflare Pages

## Database Schema

### Tables:
- **hosts** - Host user information
- **streams** - Stream details and status
- **viewers** - Viewer tracking
- **chat_messages** - Real-time chat

### Key Features:
- Row Level Security (RLS) enabled
- Automatic viewer count updates
- Stream status tracking
- Host authentication

## Technical Details

### WebRTC Configuration
- Uses free STUN/TURN servers
- Supports up to 50 concurrent viewers
- Automatic reconnection on connection loss
- ICE candidate pooling for faster connections

### Media Quality
- Video: 1280x720 @ 30fps (max 1920x1080)
- Audio: Echo cancellation, noise suppression
- Recording: WebM format with VP9/Opus

### Real-time Features
- Supabase Realtime for signaling
- Live chat updates
- Stream status changes
- Viewer count tracking

## Troubleshooting

### Common Issues:
1. **Camera not working** - Check browser permissions
2. **Connection issues** - Ensure HTTPS in production
3. **Stream not starting** - Verify Supabase connection
4. **Viewers can't connect** - Check TURN server availability

### Browser Support:
- Chrome/Edge (full support)
- Firefox (good support)
- Safari (limited WebRTC support)
- Mobile browsers (supported)

## Security Notes
- All API routes protected with authentication
- RLS policies prevent unauthorized data access
- Host-only stream creation and management
- Secure session management with Supabase

## Production Checklist
- [ ] Set up custom domain
- [ ] Configure HTTPS
- [ ] Set up monitoring/analytics
- [ ] Test with multiple viewers
- [ ] Verify recording functionality
- [ ] Set up backup strategy
- [ ] Configure error logging

## Support
For issues and questions:
1. Check browser console for errors
2. Verify Supabase connection
3. Test camera/microphone permissions
4. Check network connectivity

## Future Enhancements
- YouTube stream recording
- Cloud storage integration
- Advanced analytics
- Stream scheduling
- Multi-host streams
- Screen sharing
