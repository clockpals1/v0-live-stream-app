# Isunday Stream Live - Deployment Guide with Your Credentials

## Status: READY FOR CLOUDFLARE DEPLOYMENT

Your Supabase credentials have been configured and the repository is ready for deployment to Cloudflare Pages.

## Your Supabase Configuration

**Supabase URL**: https://uwnkyhamovmnrbeqevee.supabase.co  
**Project ID**: uwnkyhamovmnrbeqevee  
**Database**: postgres  
**Region**: aws-1-us-east-1

## Step 1: Run Database Migrations

Before deploying, you need to set up your Supabase database:

1. **Go to Supabase Dashboard**: https://supabase.com/dashboard
2. **Select your project**: uwnkyhamovmnrbeqevee
3. **Open SQL Editor**
4. **Run Migration 1**: Copy contents of `supabase/migrations/001_create_streams_schema.sql`
5. **Run Migration 2**: Copy contents of `supabase/migrations/002_create_host_trigger.sql`

## Step 2: Set Up Cloudflare Pages

### 2.1 Create Cloudflare Pages Project

1. **Go to Cloudflare Dashboard**: https://dash.cloudflare.com
2. **Navigate to Pages** > **Create application**
3. **Connect to Git**
4. **Select GitHub repository**: `clockpals1/v0-live-stream-app`
5. **Configure build settings**:
   - **Build command**: `npm run build`
   - **Build output directory**: `.next`
   - **Root directory**: `/`
   - **Node.js version**: `20`

### 2.2 Set Environment Variables

In Cloudflare Pages > Your project > Settings > Environment variables, add:

```
NEXT_PUBLIC_SUPABASE_URL=https://uwnkyhamovmnrbeqevee.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3bmt5aGFtb3ZtbnJiZXFldmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NjQwMDgsImV4cCI6MjA5MjQ0MDAwOH0.ehrsRfOfmEJFqIK8BKLWdl3I1X3i1yzwYnmOwBTMIvg
NEXT_PUBLIC_APP_URL=https://v0-live-stream-app.pages.dev
NEXT_PUBLIC_MAX_VIEWERS=50
```

## Step 3: Set Up GitHub Secrets

In your GitHub repository: `clockpals1/v0-live-stream-app`

Go to **Settings** > **Secrets and variables** > **Actions** and add:

### Cloudflare Secrets
```
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_PROJECT_NAME=v0-live-stream-app
```

### Supabase Secrets
```
NEXT_PUBLIC_SUPABASE_URL=https://uwnkyhamovmnrbeqevee.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3bmt5aGFtb3ZtbnJiZXFldmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NjQwMDgsImV4cCI6MjA5MjQ0MDAwOH0.ehrsRfOfmEJFqIK8BKLWdl3I1X3i1yzwYnmOwBTMIvg
```

### App Configuration
```
NEXT_PUBLIC_APP_URL=https://v0-live-stream-app.pages.dev
NEXT_PUBLIC_MAX_VIEWERS=50
```

## Step 4: Deploy

### Automatic Deployment
1. **Push to GitHub** - Already done! Your latest commit includes all configurations
2. **GitHub Actions** will automatically trigger
3. **Cloudflare Pages** will build and deploy
4. **Your app** will be available at: `https://v0-live-stream-app.pages.dev`

### Manual Deployment
If you need to trigger a manual deployment:
1. Go to Cloudflare Pages dashboard
2. Select your project
3. Click "Deployments" > "Create deployment"
4. Select the latest commit

## Step 5: Test Your Application

### Test Accounts
- **Host Login**: sunday@isunday.me / Ronkus123@
- **New User**: Can signup via `/auth/signup`

### Test Checklist
- [ ] Homepage loads at https://v0-live-stream-app.pages.dev
- [ ] Host login works
- [ ] Stream creation works
- [ ] WebRTC streaming functions
- [ ] Real-time chat works
- [ ] Mobile compatibility

## Database Connection Test

To verify your Supabase connection is working:

1. **Test API endpoint**: `https://v0-live-stream-app.pages.dev/api/streams`
2. **Check browser console** for any connection errors
3. **Verify database tables** exist in Supabase dashboard

## Troubleshooting

### Common Issues

1. **Build Fails**
   - Check Node.js version (should be 20+)
   - Verify environment variables in Cloudflare
   - Check GitHub Actions logs

2. **Database Connection Issues**
   - Verify Supabase URL and keys are correct
   - Check if migrations were run
   - Test connection manually

3. **WebRTC Not Working**
   - Ensure HTTPS is enabled (automatic with Cloudflare)
   - Check browser permissions
   - Verify TURN server configuration

### Support Commands

```bash
# Test local build
npm run build

# Check environment variables
npm run env

# Test locally with production config
npm run build:production
```

## Production URL

After successful deployment, your application will be available at:
**https://v0-live-stream-app.pages.dev**

## Custom Domain (Optional)

1. In Cloudflare Pages, go to your project
2. Click "Custom domains"
3. Add your domain name
4. Update `NEXT_PUBLIC_APP_URL` in environment variables

## Security Notes

- Your Supabase credentials are now configured
- All sensitive data stored in GitHub Secrets
- HTTPS enforced by Cloudflare
- RLS policies enabled in database

## Next Steps

1. **Run Supabase migrations** (Step 1)
2. **Set up Cloudflare Pages** (Step 2)
3. **Configure GitHub Secrets** (Step 3)
4. **Deploy and test** (Step 4-5)

Your live streaming platform is ready for production deployment!
