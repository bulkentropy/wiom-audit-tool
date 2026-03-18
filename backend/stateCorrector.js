/**
 * stateCorrector.js
 * Resolves grey-zone lifecycle situations for "unexpected" devices.
 *
 * Returns a resolution object for a given scanned device that is NOT on a
 * partner's expected list.
 *
 * Resolution categories:
 *  STATE_CORRECTED  – device can be auto-resolved (state updated in memory)
 *  NEEDS_INVESTIGATION – dispatched to this partner but unclear
 *  CROSS_PARTNER_UNAUTHORIZED – dispatched to a different partner
 *  UNKNOWN_DEVICE – not in Wiom's system at all
 */

function resolveUnexpected(deviceId, scannedByPartnerId, db) {
  const dispatchRow = db.dispatchByDevice.get(deviceId);

  // Not in system at all
  if (!dispatchRow) {
    return {
      category: 'UNKNOWN_DEVICE',
      label: '🚨 Unknown Device',
      description: "This device ID is not in Wiom's system.",
      newState: null,
    };
  }

  // Dispatched to a different partner
  if (dispatchRow.partner_id !== scannedByPartnerId) {
    const originalPartner = db.partnerById.get(dispatchRow.partner_id);
    return {
      category: 'CROSS_PARTNER_UNAUTHORIZED',
      label: '🚨 Unauthorized',
      description: `Dispatched to ${originalPartner ? originalPartner.partner_name : dispatchRow.partner_id}, not this partner.`,
      newState: null,
    };
  }

  // Dispatched to THIS partner — check lifecycle
  const state   = db.stateByDevice.get(deviceId) || 'unknown';
  const tickets = db.ticketsByDevice.get(deviceId) || [];

  // Expired pickup ticket — device was supposed to be recovered but never logged
  const hasExpired = tickets.some(t => t.status === 'expired');
  if (hasExpired) {
    const newState = 'at_partner_recovered_unlogged';
    db.stateByDevice.set(deviceId, newState);
    db.stateCorrections.push({
      device_id: deviceId,
      partner_id: scannedByPartnerId,
      old_state: state,
      new_state: newState,
      reason: 'Expired pickup ticket — device found with partner',
      corrected_at: new Date().toISOString(),
    });
    return {
      category: 'STATE_CORRECTED',
      label: '🔄 State Corrected',
      description: 'Device had expired pickup ticket — state corrected to recovered.',
      newState,
    };
  }

  // at_customer but plan expired → same correction
  if (state === 'at_customer') {
    const newState = 'at_partner_recovered_unlogged';
    db.stateByDevice.set(deviceId, newState);
    db.stateCorrections.push({
      device_id: deviceId,
      partner_id: scannedByPartnerId,
      old_state: state,
      new_state: newState,
      reason: 'Device marked at_customer found physically at partner — plan likely expired',
      corrected_at: new Date().toISOString(),
    });
    return {
      category: 'STATE_CORRECTED',
      label: '🔄 State Corrected',
      description: 'Device was marked as at customer but found physically with partner — state corrected.',
      newState,
    };
  }

  // Default: dispatched here but no clear resolution
  return {
    category: 'NEEDS_INVESTIGATION',
    label: '⚠️ Needs Investigation',
    description: 'Device is dispatched to this partner but the current state is unclear.',
    newState: null,
  };
}

module.exports = { resolveUnexpected };
