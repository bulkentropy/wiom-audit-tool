/**
 * server.js
 * Wiom Netbox Physical Verification Tool — Express server
 */

const path    = require('path');
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const fs      = require('fs');

const { loadAll }          = require('./csvLoader');
const { computeExpectedList } = require('./reconcile');
const { resolveUnexpected }   = require('./stateCorrector');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Body parsing + Sessions (must come before routes) ────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Sessions ──────────────────────────────────────────────────────────────────
app.use(session({
  secret: 'wiom-audit-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));

// ── Multer (CSV uploads) ──────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

// ── Load data ─────────────────────────────────────────────────────────────────
let db;
try {
  db = loadAll();
  console.log('✅ CSV data loaded successfully');
} catch (err) {
  console.error('❌ Could not load CSV data:', err.message);
  console.error('   Run: node backend/mockDataGen.js');
  process.exit(1);
}

// In-memory audit sessions: partner_id → { scanned: Map(device_id → result), submittedAt, status }
const auditSessions = new Map();

// Pre-compute expected lists for all partners at startup
const expectedListCache = new Map();
for (const p of db.partners) {
  expectedListCache.set(p.partner_id, computeExpectedList(p.partner_id, db));
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
const OPS_CREDENTIALS = { username: 'admin', password: 'wiom@2026' };

function requireOps(req, res, next) {
  if (req.session && req.session.opsLoggedIn) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requirePartner(req, res, next) {
  if (req.session && req.session.partnerId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Static files (CSS/JS — served after route declarations to avoid
//    directory-index conflicts with /ops and /partner route prefixes) ──────────
app.use(express.static(path.join(__dirname, '..', 'frontend'), { redirect: false }));

// ── Routing — serve HTML pages ────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/ops'));

app.get('/ops',               (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'ops', 'login.html')));
app.get('/ops/home',          (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'ops', 'index.html')));
app.get('/ops/dashboard',     (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'ops', 'dashboard.html')));
app.get('/ops/partner-detail',(req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'ops', 'partner-detail.html')));

app.get('/presentation',      (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'presentation', 'index.html')));

app.get('/partner',           (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'partner', 'login.html')));
app.get('/partner/welcome',   (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'partner', 'welcome.html')));
app.get('/partner/audit',     (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'partner', 'audit.html')));
app.get('/partner/complete',  (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'partner', 'complete.html')));

// ── API — Ops Auth ────────────────────────────────────────────────────────────
app.post('/api/ops/login', (req, res) => {
  const { username, password } = req.body;
  if (username === OPS_CREDENTIALS.username && password === OPS_CREDENTIALS.password) {
    req.session.opsLoggedIn = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/ops/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/ops/me', requireOps, (req, res) => {
  res.json({ loggedIn: true });
});

// ── API — Ops Data ────────────────────────────────────────────────────────────
app.get('/api/ops/summary', requireOps, (req, res) => {
  const rows = db.partners.map(p => {
    const audit   = auditSessions.get(p.partner_id) || {};
    const expected = expectedListCache.get(p.partner_id) || [];
    const scanned  = audit.scanned || new Map();

    let verified = 0, missing = 0, unexpected = 0;
    for (const dev of expected) {
      if (scanned.has(dev.device_id)) verified++;
      else missing++;
    }
    for (const [id, result] of scanned) {
      const onList = expected.some(e => e.device_id === id);
      if (!onList) unexpected++;
    }

    return {
      partner_id:   p.partner_id,
      partner_name: p.partner_name,
      city:         p.city,
      username:     p.username,
      pin:          p.pin,
      expected:     expected.length,
      status:       audit.submittedAt ? 'submitted' : scanned.size > 0 ? 'in_progress' : 'not_started',
      verified,
      missing,
      unexpected,
      no_devices:   !!(audit.noDevices),
      submitted_at: audit.submittedAt || null,
    };
  });
  res.json(rows);
});

app.get('/api/ops/partner/:id', requireOps, (req, res) => {
  const partner  = db.partnerById.get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const expected = expectedListCache.get(req.params.id) || [];
  const audit    = auditSessions.get(req.params.id) || {};
  const scanned  = audit.scanned || new Map();

  const devices = expected.map(dev => {
    const scanResult = scanned.get(dev.device_id);
    return {
      ...dev,
      status: scanResult ? 'verified' : 'missing',
    };
  });

  // Unexpected devices
  const unexpected = [];
  for (const [id, result] of scanned) {
    const onList = expected.some(e => e.device_id === id);
    if (!onList) {
      unexpected.push({ device_id: id, ...result });
    }
  }

  res.json({
    partner,
    expected: expected.length,
    devices,
    unexpected,
    submitted_at: audit.submittedAt || null,
    status: audit.submittedAt ? 'submitted' : scanned.size > 0 ? 'in_progress' : 'not_started',
    state_corrections: db.stateCorrections.filter(c => c.partner_id === req.params.id),
  });
});

// ── API — Ops Reports ─────────────────────────────────────────────────────────
app.get('/api/ops/report/full', requireOps, (req, res) => {
  const lines = ['partner_id,partner_name,device_id,mac_id,dispatch_date,status,scan_resolution'];
  for (const p of db.partners) {
    const expected = expectedListCache.get(p.partner_id) || [];
    const audit    = auditSessions.get(p.partner_id) || {};
    const scanned  = audit.scanned || new Map();

    for (const dev of expected) {
      const s = scanned.has(dev.device_id) ? 'verified' : 'missing';
      lines.push(`"${p.partner_id}","${p.partner_name}","${dev.device_id}","${dev.mac_id}","${dev.dispatch_date}","${s}",""`);
    }
    for (const [id, result] of scanned) {
      const onList = expected.some(e => e.device_id === id);
      if (!onList) {
        lines.push(`"${p.partner_id}","${p.partner_name}","${id}","","","unexpected","${result.category || ''}"`);
      }
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="full_reconciliation.csv"');
  res.send(lines.join('\n'));
});

app.get('/api/ops/report/corrections', requireOps, (req, res) => {
  const lines = ['device_id,partner_id,old_state,new_state,reason,corrected_at'];
  for (const c of db.stateCorrections) {
    lines.push(`"${c.device_id}","${c.partner_id}","${c.old_state}","${c.new_state}","${c.reason}","${c.corrected_at}"`);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="state_corrections.csv"');
  res.send(lines.join('\n'));
});

app.get('/api/ops/report/missing', requireOps, (req, res) => {
  const lines = ['partner_id,partner_name,device_id,mac_id,dispatch_date,batch_id'];
  for (const p of db.partners) {
    const expected = expectedListCache.get(p.partner_id) || [];
    const audit    = auditSessions.get(p.partner_id) || {};
    const scanned  = audit.scanned || new Map();
    for (const dev of expected) {
      if (!scanned.has(dev.device_id)) {
        lines.push(`"${p.partner_id}","${p.partner_name}","${dev.device_id}","${dev.mac_id}","${dev.dispatch_date}","${dev.batch_id}"`);
      }
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="missing_devices.csv"');
  res.send(lines.join('\n'));
});

// ── API — Partner Auth ────────────────────────────────────────────────────────
app.post('/api/partner/login', (req, res) => {
  const { username, pin } = req.body;
  const partner = db.partnerByUsername.get(username);
  if (partner && partner.pin === String(pin)) {
    req.session.partnerId   = partner.partner_id;
    req.session.partnerName = partner.partner_name;
    return res.json({ ok: true, partner_name: partner.partner_name });
  }
  res.status(401).json({ error: 'Invalid username or PIN' });
});

app.post('/api/partner/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ── API — Partner Audit ───────────────────────────────────────────────────────
app.get('/api/partner/me', requirePartner, (req, res) => {
  const partner  = db.partnerById.get(req.session.partnerId);
  const expected = expectedListCache.get(req.session.partnerId) || [];
  const audit    = auditSessions.get(req.session.partnerId) || {};
  const scanned  = audit.scanned || new Map();

  res.json({
    partner_id:   req.session.partnerId,
    partner_name: req.session.partnerName,
    expected_count: expected.length,
    scanned_count:  scanned.size,
    submitted:      !!audit.submittedAt,
  });
});

app.get('/api/partner/expected', requirePartner, (req, res) => {
  const expected = expectedListCache.get(req.session.partnerId) || [];
  const audit    = auditSessions.get(req.session.partnerId) || {};
  const scanned  = audit.scanned || new Map();

  res.json(expected.map(dev => ({
    ...dev,
    scanned: scanned.has(dev.device_id),
  })));
});

app.post('/api/partner/scan', requirePartner, (req, res) => {
  const { device_id } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  const partnerId = req.session.partnerId;
  const expected  = expectedListCache.get(partnerId) || [];

  if (!auditSessions.has(partnerId)) {
    auditSessions.set(partnerId, { scanned: new Map(), submittedAt: null });
  }
  const audit = auditSessions.get(partnerId);

  if (audit.submittedAt) {
    return res.status(400).json({ error: 'Audit already submitted' });
  }

  // Already scanned?
  if (audit.scanned.has(device_id)) {
    return res.json({ status: 'already_scanned', device_id });
  }

  const onExpectedList = expected.find(e => e.device_id === device_id);

  if (onExpectedList) {
    audit.scanned.set(device_id, { category: 'VERIFIED', label: '✅ Verified' });
    return res.json({
      status: 'verified',
      device_id,
      category: 'VERIFIED',
      label: '✅ Verified',
      remaining: expected.length - [...audit.scanned.keys()].filter(id => expected.some(e => e.device_id === id)).length,
    });
  }

  // Not on expected list — run grey zone resolution
  const resolution = resolveUnexpected(device_id, partnerId, db);
  audit.scanned.set(device_id, resolution);

  return res.json({
    status: 'unexpected',
    device_id,
    ...resolution,
    remaining: expected.length - [...audit.scanned.keys()].filter(id => expected.some(e => e.device_id === id)).length,
  });
});

app.post('/api/partner/submit', requirePartner, (req, res) => {
  const partnerId  = req.session.partnerId;
  const no_devices = !!(req.body && req.body.no_devices);

  if (!auditSessions.has(partnerId)) {
    auditSessions.set(partnerId, { scanned: new Map(), submittedAt: null });
  }
  const audit = auditSessions.get(partnerId);
  if (audit.submittedAt) {
    return res.status(400).json({ error: 'Already submitted' });
  }
  audit.submittedAt = new Date().toISOString();
  audit.noDevices   = no_devices;

  const expected = expectedListCache.get(partnerId) || [];
  const scanned  = audit.scanned;

  let verified = 0, missing = 0, unexpected = 0;
  for (const dev of expected) {
    if (scanned.has(dev.device_id)) verified++;
    else missing++;
  }
  for (const [id] of scanned) {
    if (!expected.some(e => e.device_id === id)) unexpected++;
  }

  res.json({ ok: true, verified, missing, unexpected, no_devices, submitted_at: audit.submittedAt });
});

app.get('/api/partner/summary', requirePartner, (req, res) => {
  const partnerId = req.session.partnerId;
  const expected  = expectedListCache.get(partnerId) || [];
  const audit     = auditSessions.get(partnerId) || { scanned: new Map() };
  const scanned   = audit.scanned;

  let verified = 0, missing = 0, unexpected = 0;
  for (const dev of expected) {
    if (scanned.has(dev.device_id)) verified++;
    else missing++;
  }
  for (const [id] of scanned) {
    if (!expected.some(e => e.device_id === id)) unexpected++;
  }

  res.json({ verified, missing, unexpected, no_devices: !!audit.noDevices, submitted: !!audit.submittedAt, submitted_at: audit.submittedAt });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀  Wiom Audit Tool running at http://localhost:${PORT}`);
  console.log(`   Ops portal:     http://localhost:${PORT}/ops`);
  console.log(`   Partner portal: http://localhost:${PORT}/partner\n`);
});
