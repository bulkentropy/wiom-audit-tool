/**
 * csvLoader.js
 * Parses all CSVs into in-memory Maps/arrays on startup.
 */

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readCSV(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Missing data file: ${filename}. Run: node backend/mockDataGen.js`);
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function loadAll() {
  const partners       = readCSV('partners.csv');
  const dispatch       = readCSV('dispatch.csv');
  const deviceStates   = readCSV('device_states.csv');
  const pickupTickets  = readCSV('pickup_tickets.csv');

  // Build lookup maps
  const partnerByUsername = new Map(partners.map(p => [p.username, p]));
  const partnerById       = new Map(partners.map(p => [p.partner_id, p]));

  // device_id → state
  const stateByDevice = new Map(deviceStates.map(d => [d.device_id, d.current_state]));

  // device_id → array of tickets (a device can have multiple)
  const ticketsByDevice = new Map();
  for (const t of pickupTickets) {
    if (!ticketsByDevice.has(t.device_id)) ticketsByDevice.set(t.device_id, []);
    ticketsByDevice.get(t.device_id).push(t);
  }

  // partner_id → dispatched device rows
  const dispatchByPartner = new Map();
  for (const d of dispatch) {
    if (!dispatchByPartner.has(d.partner_id)) dispatchByPartner.set(d.partner_id, []);
    dispatchByPartner.get(d.partner_id).push(d);
  }

  // device_id → dispatch row (global — for cross-partner lookups)
  const dispatchByDevice = new Map(dispatch.map(d => [d.device_id, d]));

  // mutable state corrections log
  const stateCorrections = [];

  return {
    partners,
    partnerByUsername,
    partnerById,
    dispatch,
    dispatchByDevice,
    dispatchByPartner,
    stateByDevice,
    ticketsByDevice,
    stateCorrections,
  };
}

module.exports = { loadAll };
