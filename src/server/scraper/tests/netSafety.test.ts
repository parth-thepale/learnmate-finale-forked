import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, UnsafeUrlError, validateFetchUrl } from '../netSafety';
import { parseRobotsTxt, robotsPolicyForResponse } from '../robots';

test('private, loopback, link-local and cloud metadata addresses are blocked', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    'fd00:ec2::254',
    'fc00::1',
    'fe80::1',
    'fe80::1%eth0',
    '64:ff9b::a9fe:a9fe',
    '2002:a00:1::',
    'ff02::1',
    'not-an-ip',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test('public addresses are allowed', () => {
  for (const address of ['8.8.8.8', '13.35.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('fetch URLs must be https, on an exact allow-listed host, without IPs, credentials or odd ports', () => {
  const hosts = ['jeemain.nta.nic.in'];
  assert.equal(validateFetchUrl('https://jeemain.nta.nic.in/a.pdf#x', hosts).toString(), 'https://jeemain.nta.nic.in/a.pdf');
  assert.equal(validateFetchUrl('https://JEEMAIN.nta.nic.in:443/a.pdf', hosts).hostname, 'jeemain.nta.nic.in');
  for (const bad of [
    'http://jeemain.nta.nic.in/a.pdf',
    'ftp://jeemain.nta.nic.in/a.pdf',
    'file:///etc/passwd',
    'https://evil.example/a.pdf',
    'https://jeemain.nta.nic.in.evil.example/a.pdf',
    'https://sub.jeemain.nta.nic.in/a.pdf',
    'https://user:pw@jeemain.nta.nic.in/a.pdf',
    'https://jeemain.nta.nic.in:8443/a.pdf',
    'https://127.0.0.1/a.pdf',
    'https://[::1]/a.pdf',
    'https://169.254.169.254/latest/meta-data/',
    'not a url',
  ]) {
    assert.throws(() => validateFetchUrl(bad, hosts), UnsafeUrlError, bad);
  }
  assert.throws(() => validateFetchUrl('https://169.254.169.254/', ['169.254.169.254']), UnsafeUrlError);
});

test('robots.txt rules: agent groups, longest match, Allow wins ties, wildcards and anchors', () => {
  const robots = parseRobotsTxt(
    [
      'User-agent: *',
      'Disallow: /wp-admin/',
      'Allow: /wp-admin/admin-ajax.php',
      'Disallow: /*.zip$',
      '',
      'User-agent: LearnmateQuestionImporter',
      'Disallow: /private/',
    ].join('\n'),
    'SomeBot/1.0'
  );
  assert.equal(robots.isAllowed('/uploads/key.pdf'), true);
  assert.equal(robots.isAllowed('/wp-admin/options.php'), false);
  assert.equal(robots.isAllowed('/wp-admin/admin-ajax.php'), true);
  assert.equal(robots.isAllowed('/files/a.zip'), false);
  assert.equal(robots.isAllowed('/files/a.zip?x=1'), true);

  const specific = parseRobotsTxt('User-agent: *\nDisallow: /\n\nUser-agent: learnmatequestionimporter\nDisallow: /private/\n', 'LearnmateQuestionImporter/1.0');
  assert.equal(specific.isAllowed('/public/a.pdf'), true);
  assert.equal(specific.isAllowed('/private/a.pdf'), false);

  assert.equal(parseRobotsTxt('User-agent: *\nDisallow:\n', 'x').isAllowed('/anything'), true);
});

test('robots.txt availability: 4xx allows everything, 5xx or unreachable disallows everything', () => {
  assert.equal(robotsPolicyForResponse(404, '', 'x').isAllowed('/a'), true);
  assert.equal(robotsPolicyForResponse(503, '', 'x').isAllowed('/a'), false);
  assert.equal(robotsPolicyForResponse(null, '', 'x').isAllowed('/a'), false);
  assert.equal(robotsPolicyForResponse(200, 'User-agent: *\nDisallow: /a', 'x').isAllowed('/a'), false);
});
