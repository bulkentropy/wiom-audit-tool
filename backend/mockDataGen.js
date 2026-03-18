/**
 * mockDataGen.js
 * Generates realistic mock CSV data for the Wiom audit tool demo.
 * Run: node backend/mockDataGen.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Partners ─────────────────────────────────────────────────────────────────
const partners = [
  { partner_id: 'P001', partner_name: 'Rajesh Telecom', city: 'Delhi',     username: 'partner_rajesh', pin: '1234', operating_windows: 'Mon-Sat 9am-7pm' },
  { partner_id: 'P002', partner_name: 'Sunita Networks', city: 'Mumbai',   username: 'partner_sunita', pin: '2345', operating_windows: 'Mon-Sun 8am-9pm' },
  { partner_id: 'P003', partner_name: 'KP Enterprises',  city: 'Bangalore',username: 'partner_kp',    pin: '3456', operating_windows: 'Mon-Fri 10am-6pm' },
  { partner_id: 'P004', partner_name: 'Mehta Connect',   city: 'Hyderabad',username: 'partner_mehta', pin: '4567', operating_windows: 'Mon-Sat 9am-8pm' },
  { partner_id: 'P005', partner_name: 'Sharma Fibernet', city: 'Pune',     username: 'partner_sharma',pin: '5678', operating_windows: 'Mon-Sun 9am-6pm' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
let deviceCounter = 1000;
function makeDevice() {
  const id = `DEV${String(++deviceCounter).padStart(5, '0')}`;
  const mac = Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()
  ).join(':');
  return { device_id: id, mac_id: mac };
}

function randomDate(start, end) {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split('T')[0];
}

const batchStart = new Date('2025-06-01');
const batchEnd   = new Date('2026-01-01');
let batchCounter = 1;
function makeBatch() { return `BATCH${String(batchCounter++).padStart(3, '0')}`; }

let ticketCounter = 1;
function makeTicket() { return `TKT${String(ticketCounter++).padStart(5, '0')}`; }

// ── Build rows ─────────────────────────────────────────────────────────────────
const dispatchRows    = [];
const deviceStateRows = [];
const ticketRows      = [];

/**
 * Helper: dispatch N devices to a partner and set states/tickets according to scenario.
 * Returns array of device_ids for further manipulation.
 */
function dispatchDevices(partner_id, count, state, ticketStatus = null, expiredDays = null) {
  const batch = makeBatch();
  const dispatchDate = randomDate(batchStart, batchEnd);

  for (let i = 0; i < count; i++) {
    const dev = makeDevice();
    dispatchRows.push({ partner_id, device_id: dev.device_id, mac_id: dev.mac_id, dispatch_date: dispatchDate, batch_id: batch });
    deviceStateRows.push({ device_id: dev.device_id, current_state: state });

    if (ticketStatus) {
      const created = randomDate(new Date('2025-08-01'), new Date('2025-12-01'));
      const closed  = ticketStatus !== 'active' ? randomDate(new Date(created), new Date('2026-01-15')) : '';
      ticketRows.push({ ticket_id: makeTicket(), device_id: dev.device_id, partner_id, status: ticketStatus, created_at: created, closed_at: closed });
    }
  }
}

// ── P001 – Rajesh Telecom: Clean case — all expected devices present ───────────
// 20 devices: 15 at_partner (expected), 3 at_customer (active plan), 2 returned (at_wiom)
dispatchDevices('P001', 15, 'at_partner');
dispatchDevices('P001', 3,  'at_customer', 'active');
dispatchDevices('P001', 2,  'at_wiom');     // returned — not expected

// ── P002 – Sunita Networks: 3 missing + 2 grey zone (expired tickets) ─────────
// 18 expected + 2 grey zone
dispatchDevices('P002', 13, 'at_partner');              // normal expected
dispatchDevices('P002', 3,  'at_partner');              // expected but partner will claim missing
dispatchDevices('P002', 2,  'at_customer', 'expired'); // grey zone: plan expired, device should be back
dispatchDevices('P002', 2,  'at_wiom');                // returned

// ── P003 – KP Enterprises: 1 unauthorized device (from P001's dispatch) ────────
// We'll inject a P001 device into their scan in server logic; here just normal dispatch
dispatchDevices('P003', 18, 'at_partner');
dispatchDevices('P003', 2,  'at_customer', 'active');
// one extra device from P001 will be added server-side for the unauthorized scan scenario
// we embed a known P001 device_id marker in data for this
const unauthorizedDeviceForP003 = makeDevice();
// Dispatch to P001 but it will be physically at P003
dispatchRows.push({ partner_id: 'P001', device_id: unauthorizedDeviceForP003.device_id, mac_id: unauthorizedDeviceForP003.mac_id, dispatch_date: randomDate(batchStart, batchEnd), batch_id: makeBatch() });
deviceStateRows.push({ device_id: unauthorizedDeviceForP003.device_id, current_state: 'at_partner' });
// Save this device ID so server can reference it
fs.writeFileSync(path.join(DATA_DIR, 'unauthorized_device.json'), JSON.stringify({ device_id: unauthorizedDeviceForP003.device_id, dispatched_to: 'P001', physically_at: 'P003' }));

// ── P004 – Mehta Connect: Mix of all categories ───────────────────────────────
dispatchDevices('P004', 10, 'at_partner');             // will be verified
dispatchDevices('P004', 3,  'at_partner');             // will be missing
dispatchDevices('P004', 2,  'at_customer', 'expired'); // grey zone
dispatchDevices('P004', 2,  'at_customer', 'active');  // legitimately at customer
dispatchDevices('P004', 1,  'at_wiom');                // returned

// ── P005 – Sharma Fibernet: Partially submitted (in-progress) ─────────────────
dispatchDevices('P005', 17, 'at_partner');
dispatchDevices('P005', 2,  'at_customer', 'active');
dispatchDevices('P005', 1,  'at_wiom');                // returned

// ── Write CSVs ─────────────────────────────────────────────────────────────────
function writeCSV(filename, rows) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]).join(',');
  const body = rows.map(r => Object.values(r).map(v => `"${v}"`).join(',')).join('\n');
  fs.writeFileSync(path.join(DATA_DIR, filename), `${headers}\n${body}\n`, 'utf8');
  console.log(`✅  ${filename} — ${rows.length} rows`);
}

writeCSV('dispatch.csv',      dispatchRows);
writeCSV('device_states.csv', deviceStateRows);
writeCSV('pickup_tickets.csv', ticketRows);
writeCSV('partners.csv',      partners);

console.log('\n🎉 Mock data generated in /data/');
console.log(`   Total devices dispatched: ${dispatchRows.length}`);
console.log(`   Partners: ${partners.length}`);
