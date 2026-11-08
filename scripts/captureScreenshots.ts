import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outputDir = path.resolve('screenshots');

interface PageTarget {
  name: string;
  url: string;
  width: number;
  height: number;
  filename: string;
}

const targets: PageTarget[] = [
  // Home
  { name: 'Home Desktop Light', url: 'http://localhost:3000/?theme=light#home', width: 1280, height: 900, filename: 'home-desktop-light.png' },
  { name: 'Home Desktop Dark', url: 'http://localhost:3000/?theme=dark#home', width: 1280, height: 900, filename: 'home-desktop-dark.png' },
  { name: 'Home Mobile Light', url: 'http://localhost:3000/?theme=light#home', width: 375, height: 812, filename: 'home-mobile-light.png' },
  
  // Sessions & AI Tutor
  { name: 'Sessions Desktop Light', url: 'http://localhost:3000/?theme=light#sessions', width: 1280, height: 900, filename: 'sessions-desktop-light.png' },
  { name: 'Sessions Desktop Dark', url: 'http://localhost:3000/?theme=dark#sessions', width: 1280, height: 900, filename: 'sessions-desktop-dark.png' },
  { name: 'Sessions Mobile Light', url: 'http://localhost:3000/?theme=light#sessions', width: 375, height: 812, filename: 'sessions-mobile-light.png' },

  // Chapters
  { name: 'Chapters Desktop Light', url: 'http://localhost:3000/?theme=light#chapters', width: 1280, height: 900, filename: 'chapters-desktop-light.png' },
  { name: 'Chapters Desktop Dark', url: 'http://localhost:3000/?theme=dark#chapters', width: 1280, height: 900, filename: 'chapters-desktop-dark.png' },

  // Roadmaps
  { name: 'Roadmaps Desktop Light', url: 'http://localhost:3000/?theme=light#roadmaps', width: 1280, height: 900, filename: 'roadmaps-desktop-light.png' },
  { name: 'Roadmaps Desktop Dark', url: 'http://localhost:3000/?theme=dark#roadmaps', width: 1280, height: 900, filename: 'roadmaps-desktop-dark.png' },

  // Mocks / Practice
  { name: 'Mocks Desktop Light', url: 'http://localhost:3000/?theme=light#mocks', width: 1280, height: 900, filename: 'mocks-desktop-light.png' },
  { name: 'Mocks Desktop Dark', url: 'http://localhost:3000/?theme=dark#mocks', width: 1280, height: 900, filename: 'mocks-desktop-dark.png' },

  // Profile & Quotas
  { name: 'Profile Desktop Light', url: 'http://localhost:3000/?theme=light#profile', width: 1280, height: 900, filename: 'profile-desktop-light.png' },
  { name: 'Profile Desktop Dark', url: 'http://localhost:3000/?theme=dark#profile', width: 1280, height: 900, filename: 'profile-desktop-dark.png' },
];

async function captureAll() {
  console.log('Capturing real browser screenshots for release audit...\n');
  
  for (const t of targets) {
    const outFile = path.join(outputDir, t.filename);
    console.log(`Capturing: ${t.name} -> ${t.filename} (${t.width}x${t.height})`);
    try {
      // Using --headless=new --virtual-time-budget=4000 to allow React to mount and hydrate
      execSync(`"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=4000 --window-size=${t.width},${t.height} --screenshot="${outFile}" "${t.url}"`, {
        timeout: 25000,
        stdio: 'pipe',
      });
      const exists = fs.existsSync(outFile);
      const size = exists ? fs.statSync(outFile).size : 0;
      console.log(`  ✓ Success: ${size} bytes saved`);
    } catch (err) {
      console.error(`  ✗ Error capturing ${t.name}:`, (err as Error).message);
    }
  }

  // Also verify DOM footer on Home vs Sessions
  console.log('\nChecking footer isolation in rendered DOM...');
  try {
    const homeDom = execSync(`"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3000 --dump-dom "http://localhost:3000/?theme=light#home"`, {
      timeout: 20000,
      encoding: 'utf8',
    });
    const sessionsDom = execSync(`"${chromePath}" --headless=new --disable-gpu --virtual-time-budget=3000 --dump-dom "http://localhost:3000/?theme=light#sessions"`, {
      timeout: 20000,
      encoding: 'utf8',
    });

    const homeHasFooter = homeDom.includes('<footer') || homeDom.includes('Minimal Editorial Paper Footer') || homeDom.includes('2026 Learnmate');
    const sessionsHasFooter = sessionsDom.includes('<footer') || sessionsDom.includes('Minimal Editorial Paper Footer') || sessionsDom.includes('2026 Learnmate');

    console.log(`  Home DOM contains footer: ${homeHasFooter}`);
    console.log(`  Sessions DOM contains footer: ${sessionsHasFooter}`);
    console.log(`  Footer isolation verified: ${homeHasFooter && !sessionsHasFooter ? 'PASS' : 'FAIL'}`);
  } catch (err) {
    console.error('DOM dump error:', err);
  }
}

captureAll();
