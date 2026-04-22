// Feature Testing Script for Isunday Stream Live
// Run this in the browser console to test all features

const FeatureTester = {
  results: [],
  
  log(test, passed, details = '') {
    this.results.push({ test, passed, details, timestamp: new Date() });
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${test}${details ? ' - ' + details : ''}`);
  },

  async testSupabaseConnection() {
    try {
      const response = await fetch('/api/streams', { method: 'GET' });
      const data = await response.json();
      this.log('Supabase API Connection', response.ok, `Status: ${response.status}`);
    } catch (error) {
      this.log('Supabase API Connection', false, error.message);
    }
  },

  testWebRTCSupport() {
    const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && 
                        window.RTCPeerConnection);
    this.log('WebRTC Support', supported, supported ? 'Full support' : 'Limited/No support');
  },

  async testCameraAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: false 
      });
      stream.getTracks().forEach(track => track.stop());
      this.log('Camera Access', true, 'Camera permission granted');
    } catch (error) {
      this.log('Camera Access', false, error.name);
    }
  },

  async testMicrophoneAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: false, 
        audio: true 
      });
      stream.getTracks().forEach(track => track.stop());
      this.log('Microphone Access', true, 'Microphone permission granted');
    } catch (error) {
      this.log('Microphone Access', false, error.name);
    }
  },

  testLocalStorage() {
    try {
      localStorage.setItem('test', 'test');
      localStorage.removeItem('test');
      this.log('Local Storage', true, 'Working correctly');
    } catch (error) {
      this.log('Local Storage', false, error.message);
    }
  },

  testSessionStorage() {
    try {
      sessionStorage.setItem('test', 'test');
      sessionStorage.removeItem('test');
      this.log('Session Storage', true, 'Working correctly');
    } catch (error) {
      this.log('Session Storage', false, error.message);
    }
  },

  testResponsiveDesign() {
    const width = window.innerWidth;
    const isMobile = width <= 768;
    const isTablet = width > 768 && width <= 1024;
    const isDesktop = width > 1024;
    
    this.log('Responsive Design', true, 
      `${width}px - ${isMobile ? 'Mobile' : isTablet ? 'Tablet' : 'Desktop'}`);
  },

  testBrowserCompatibility() {
    const userAgent = navigator.userAgent;
    const isChrome = /Chrome/.test(userAgent);
    const isFirefox = /Firefox/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    
    this.log('Browser Detection', true, 
      `${isChrome ? 'Chrome' : isFirefox ? 'Firefox' : isSafari ? 'Safari' : 'Other'}`);
  },

  testNetworkConnection() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      this.log('Network Info', true, 
        `${connection.effectiveType} - ${connection.downlink}Mbps`);
    } else {
      this.log('Network Info', false, 'Network API not available');
    }
  },

  async testAuthenticationEndpoints() {
    try {
      // Test login endpoint (should fail with wrong credentials)
      const response = await fetch('/auth/login', { method: 'GET' });
      this.log('Auth Endpoint Access', response.ok || response.status === 405, 
        `Status: ${response.status}`);
    } catch (error) {
      this.log('Auth Endpoint Access', false, error.message);
    }
  },

  testEnvironmentVariables() {
    const hasSupabaseUrl = !!process.env?.NEXT_PUBLIC_SUPABASE_URL || 
                          window.location.hostname !== 'localhost';
    this.log('Environment Setup', hasSupabaseUrl, 
      hasSupabaseUrl ? 'Configured' : 'Using localhost');
  },

  generateReport() {
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const percentage = Math.round((passed / total) * 100);
    
    console.log('\n=== FEATURE TEST REPORT ===');
    console.log(`Passed: ${passed}/${total} (${percentage}%)`);
    console.log('==========================\n');
    
    this.results.forEach(result => {
      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(`${status}: ${result.test}`);
      if (result.details) console.log(`    ${result.details}`);
    });
    
    console.log('\n=== RECOMMENDATIONS ===');
    
    if (percentage < 80) {
      console.log('Some critical features may not work properly.');
    }
    
    const failedTests = this.results.filter(r => !r.passed);
    if (failedTests.length > 0) {
      console.log('Failed tests:');
      failedTests.forEach(test => {
        console.log(`- ${test.test}: ${test.details}`);
      });
    }
    
    console.log('\n=== NEXT STEPS ===');
    console.log('1. Fix any failed tests');
    console.log('2. Test with multiple browsers');
    console.log('3. Test on mobile devices');
    console.log('4. Test actual streaming functionality');
  },

  async runAllTests() {
    console.log('Starting feature tests...\n');
    
    await this.testSupabaseConnection();
    this.testWebRTCSupport();
    await this.testCameraAccess();
    await this.testMicrophoneAccess();
    this.testLocalStorage();
    this.testSessionStorage();
    this.testResponsiveDesign();
    this.testBrowserCompatibility();
    this.testNetworkConnection();
    await this.testAuthenticationEndpoints();
    this.testEnvironmentVariables();
    
    this.generateReport();
  }
};

// Run tests automatically
console.log('Isunday Stream Live - Feature Tester');
console.log('Run: FeatureTester.runAllTests() to start testing');
console.log('Or run individual tests like: FeatureTester.testWebRTCSupport()');
