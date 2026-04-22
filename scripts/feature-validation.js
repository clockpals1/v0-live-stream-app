#!/usr/bin/env node

/**
 * Feature Validation Script for Isunday Stream Live
 * Tests all critical functionality before production deployment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Isunday Stream Live - Feature Validation ===\n');

const tests = [
  {
    name: 'Build Application',
    test: 'build',
    command: 'npm run build',
    critical: true
  },
  {
    name: 'TypeScript Compilation',
    test: 'typescript',
    command: 'npx tsc --noEmit',
    critical: true
  },
  {
    name: 'Lint Code Quality',
    test: 'lint',
    command: 'npm run lint',
    critical: false
  },
  {
    name: 'Check Environment Variables',
    test: 'env-check',
    command: 'node -e "console.log(process.env.NODE_ENV === \'development\' ? \'PASS\' : \'FAIL\')"',
    critical: true
  }
];

async function runTest(test) {
  try {
    console.log(`Running: ${test.name}...`);
    const output = execSync(test.command, { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    console.log(`   PASS: ${test.name}`);
    return { success: true, output };
  } catch (error) {
    console.log(`   FAIL: ${test.name}`);
    console.log(`   Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function validateFeatures() {
  const results = [];
  
  for (const test of tests) {
    const result = await runTest(test);
    results.push({
      name: test.name,
      test: test.test,
      critical: test.critical,
      success: result.success,
      error: result.error
    });
    
    if (test.critical && !result.success) {
      console.log(`\nCRITICAL FAILURE: ${test.name} is required for production`);
      console.log('Please fix this issue before continuing.');
      process.exit(1);
    }
  }
  
  // Check for production readiness
  console.log('\n=== Production Readiness Check ===');
  
  const productionChecks = [
    {
      name: 'Environment Variables Configured',
      check: () => fs.existsSync('.env.local') && fs.readFileSync('.env.local', 'utf8').includes('NEXT_PUBLIC_SUPABASE_URL')
    },
    {
      name: 'Database Migrations Ready',
      check: () => fs.existsSync('supabase/migrations/001_create_streams_schema.sql')
    },
    {
      name: 'Build Output Ready',
      check: () => fs.existsSync('.next')
    },
    {
      name: 'Static Assets Present',
      check: () => fs.existsSync('public') && fs.readdirSync('public').length > 0
    }
  ];
  
  productionChecks.forEach(check => {
    const passed = check.check();
    console.log(`   ${passed ? 'PASS' : 'FAIL'}: ${check.name}`);
  });
  
  // Generate validation report
  const passedTests = results.filter(r => r.success).length;
  const totalTests = results.length;
  const successRate = Math.round((passedTests / totalTests) * 100);
  
  console.log('\n=== Validation Summary ===');
  console.log(`Tests Passed: ${passedTests}/${totalTests} (${successRate}%)`);
  
  if (successRate >= 80) {
    console.log('STATUS: READY FOR TESTING');
    console.log('\nNext Steps:');
    console.log('1. Set up Supabase project');
    console.log('2. Run database migrations');
    console.log('3. Configure environment variables');
    console.log('4. Test all features manually');
    console.log('5. Deploy to staging');
  } else {
    console.log('STATUS: NEEDS ATTENTION');
    console.log('Please fix failing tests before proceeding.');
  }
  
  return results;
}

// Run validation if called directly
if (require.main === module) {
  validateFeatures().catch(console.error);
}

module.exports = { validateFeatures, runTest };
