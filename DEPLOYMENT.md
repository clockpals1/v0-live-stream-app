# Isunday Stream Live - Deployment Guide

## Overview
This guide covers deploying Isunday Stream Live to Cloudflare Pages using GitHub Actions CI/CD pipeline.

## Prerequisites
- GitHub repository
- Cloudflare account
- Supabase project
- Node.js 20+

## Step 1: Set Up Supabase

1. **Create Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Create new project
   - Note the Project URL and Anon Key

2. **Run Database Migrations**
   - Open Supabase SQL Editor
   - Copy contents of `supabase/migrations/001_create_streams_schema.sql`
   - Execute the migration
   - Copy contents of `supabase/migrations/002_create_host_trigger.sql`
   - Execute the migration

3. **Get Supabase Credentials**
   - Project Settings > API
   - Copy: Project URL, Anon Key, Service Role Key

## Step 2: Set Up GitHub Repository

1. **Initialize Git Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Isunday Stream Live"
   ```

2. **Create GitHub Repository**
   - Go to GitHub and create new repository
   - Add remote origin:
   ```bash
   git remote add origin https://github.com/yourusername/isunday-stream-live.git
   git push -u origin main
   ```

## Step 3: Set Up Cloudflare Pages

1. **Create Cloudflare Account**
   - Go to [cloudflare.com](https://cloudflare.com)
   - Create account or sign in

2. **Create Pages Project**
   - Go to Pages > Create application
   - Connect to Git
   - Select your GitHub repository
   - Set build command: `npm run build`
   - Set build output directory: `.next`
   - Set Node.js version: `20`

3. **Configure Environment Variables**
   In Cloudflare Pages settings, add:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   NEXT_PUBLIC_APP_URL=https://your-project.pages.dev
   NEXT_PUBLIC_MAX_VIEWERS=50
   ```

## Step 4: Set Up GitHub Secrets

In your GitHub repository, go to Settings > Secrets and variables > Actions:

1. **Cloudflare Secrets**
   ```
   CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
   CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
   CLOUDFLARE_PROJECT_NAME=isunday-stream-live
   ```

2. **Supabase Secrets**
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. **App Configuration**
   ```
   NEXT_PUBLIC_APP_URL=https://your-project.pages.dev
   NEXT_PUBLIC_MAX_VIEWERS=50
   ```

## Step 5: Deploy Application

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Ready for production deployment"
   git push origin main
   ```

2. **Monitor Deployment**
   - GitHub Actions will automatically trigger
   - Check Actions tab for deployment status
   - Cloudflare Pages will build and deploy

3. **Access Application**
   - Your app will be available at: `https://your-project.pages.dev`
   - Or your custom domain if configured

## Step 6: Production Testing

### Test Checklist:
- [ ] Homepage loads correctly
- [ ] Authentication flow works
- [ ] Stream creation works
- [ ] WebRTC streaming functions
- [ ] Real-time chat works
- [ ] Mobile compatibility
- [ ] Performance is acceptable

### Test Accounts:
- **Host**: sunday@isunday.me / Ronkus123@
- **Test Viewer**: Create account via signup

## Step 7: Custom Domain (Optional)

1. **Configure Domain in Cloudflare**
   - Go to Pages > Your project > Custom domains
   - Add your domain name

2. **Update Environment Variables**
   - Update `NEXT_PUBLIC_APP_URL` to your custom domain
   - Redeploy application

## Troubleshooting

### Common Issues:

1. **Build Fails**
   - Check Node.js version (should be 20+)
   - Verify all dependencies are installed
   - Check GitHub Actions logs

2. **Environment Variables Missing**
   - Verify all secrets are set in GitHub
   - Check Cloudflare Pages environment variables
   - Ensure `.env.production` is configured

3. **WebRTC Not Working**
   - Ensure HTTPS is enabled (required for WebRTC)
   - Check TURN server configuration
   - Verify browser permissions

4. **Database Connection Issues**
   - Verify Supabase URL and keys
   - Check RLS policies
   - Test database connectivity

### Debug Commands:

```bash
# Check build locally
npm run build

# Test production build
npm run start

# Check environment variables
npm run env
```

## CI/CD Pipeline

The GitHub Actions workflow automatically:
1. Triggers on push to main branch
2. Installs dependencies
3. Runs tests (if available)
4. Builds application
5. Deploys to Cloudflare Pages
6. Provides deployment URL

## Security Considerations

- All secrets stored in GitHub Secrets
- Environment variables not committed to repo
- HTTPS enforced in production
- RLS policies enabled in database
- Security headers configured

## Performance Optimization

- Static files optimized by Cloudflare
- CDN distribution globally
- Image optimization configured
- Build caching enabled

## Monitoring

- Cloudflare Analytics for traffic
- GitHub Actions for deployment status
- Supabase for database monitoring
- Browser console for client-side errors

---

## Quick Deployment Commands

```bash
# 1. Setup repository
git init
git add .
git commit -m "Initial commit"

# 2. Add remote
git remote add origin https://github.com/yourusername/isunday-stream-live.git

# 3. Push to trigger deployment
git push -u origin main

# 4. Monitor deployment at:
# GitHub: Actions tab
# Cloudflare: Pages dashboard
```

## Support

For deployment issues:
1. Check GitHub Actions logs
2. Review Cloudflare Pages build logs
3. Verify environment variables
4. Test with local build first

Your application should be live and fully functional after following these steps!
