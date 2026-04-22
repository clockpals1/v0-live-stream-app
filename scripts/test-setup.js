#!/usr/bin/env node

/**
 * Isunday Stream Live - Automated Testing Setup
 * This script helps validate that all components are working correctly
 */

const fs = require('fs');
const path = require('path');

console.log('=== Isunday Stream Live - Test Setup ===\n');

// Check required files
const requiredFiles = [
  '.env.local',
  'package.json',
  'next.config.mjs',
  'middleware.ts',
  'app/layout.tsx',
  'app/page.tsx',
  'lib/supabase/client.ts',
  'lib/supabase/server.ts',
  'lib/webrtc/config.ts',
  'lib/webrtc/use-host-stream.ts',
  'lib/webrtc/use-viewer-stream.ts',
  'supabase/migrations/001_create_streams_schema.sql',
  'supabase/migrations/002_create_host_trigger.sql'
];

console.log('1. Checking required files...');
let allFilesExist = true;

requiredFiles.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  const exists = fs.existsSync(filePath);
  console.log(`   ${exists ? 'PASS' : 'FAIL'}: ${file}`);
  if (!exists) allFilesExist = false;
});

if (!allFilesExist) {
  console.log('\nERROR: Some required files are missing!');
  process.exit(1);
}

// Check package.json dependencies
console.log('\n2. Checking package.json dependencies...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const requiredDeps = [
  'next',
  'react',
  '@supabase/supabase-js',
  '@supabase/ssr',
  'lucide-react',
  'nanoid'
];

const requiredDevDeps = [
  '@types/node',
  '@types/react',
  'tailwindcss'
];

let depsOk = true;
requiredDeps.forEach(dep => {
  if (!packageJson.dependencies[dep]) {
    console.log(`   FAIL: Missing dependency: ${dep}`);
    depsOk = false;
  }
});

requiredDevDeps.forEach(dep => {
  if (!packageJson.devDependencies[dep]) {
    console.log(`   FAIL: Missing dev dependency: ${dep}`);
    depsOk = false;
  }
});

if (depsOk) {
  console.log('   PASS: All required dependencies found');
}

// Check environment variables template
console.log('\n3. Checking environment configuration...');
const envExample = fs.existsSync('.env.example');
const envLocal = fs.existsSync('.env.local');

console.log(`   ${envExample ? 'PASS' : 'FAIL'}: .env.example exists`);
console.log(`   ${envLocal ? 'PASS' : 'WARN'}: .env.local exists`);

// Check database migrations
console.log('\n4. Checking database migrations...');
const migration1 = fs.existsSync('supabase/migrations/001_create_streams_schema.sql');
const migration2 = fs.existsSync('supabase/migrations/002_create_host_trigger.sql');

console.log(`   ${migration1 ? 'PASS' : 'FAIL'}: Schema migration exists`);
console.log(`   ${migration2 ? 'PASS' : 'FAIL'}: Host trigger migration exists`);

// Check API routes
console.log('\n5. Checking API routes...');
const apiRoutes = [
  'app/api/streams/route.ts',
  'app/api/streams/[roomCode]/route.ts',
  'app/api/chat/[streamId]/route.ts',
  'app/api/viewers/[streamId]/route.ts',
  'app/auth/callback/route.ts'
];

apiRoutes.forEach(route => {
  const exists = fs.existsSync(route);
  console.log(`   ${exists ? 'PASS' : 'FAIL'}: ${route}`);
});

// Check components
console.log('\n6. Checking components...');
const components = [
  'components/ui/button.tsx',
  'components/ui/card.tsx',
  'components/ui/input.tsx',
  'components/host/dashboard-content.tsx',
  'components/host/stream-interface.tsx',
  'components/viewer/stream-interface.tsx',
  'components/viewer/stream-not-found.tsx'
];

components.forEach(component => {
  const exists = fs.existsSync(component);
  console.log(`   ${exists ? 'PASS' : 'FAIL'}: ${component}`);
});

// Check pages
console.log('\n7. Checking pages...');
const pages = [
  'app/page.tsx',
  'app/auth/login/page.tsx',
  'app/auth/signup/page.tsx',
  'app/auth/forgot-password/page.tsx',
  'app/auth/reset-password/page.tsx',
  'app/host/dashboard/page.tsx',
  'app/host/stream/[roomCode]/page.tsx',
  'app/watch/[roomCode]/page.tsx'
];

pages.forEach(page => {
  const exists = fs.existsSync(page);
  console.log(`   ${exists ? 'PASS' : 'FAIL'}: ${page}`);
});

console.log('\n=== Setup Check Complete ===');
console.log('\nNext steps:');
console.log('1. Set up Supabase project');
console.log('2. Run database migrations');
console.log('3. Configure .env.local with your Supabase credentials');
console.log('4. Run: npm run dev');
console.log('5. Open: http://localhost:3000');
console.log('6. Follow the TESTING.md checklist');
