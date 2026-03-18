/**
 * reconcile.js
 * Computes the "expected accountability list" per partner.
 *
 * Expected at partner =
 *   All devices dispatched to partner
 *   MINUS devices returned to warehouse (state: at_wiom)
 *   MINUS devices on active customer plans (state: at_customer AND no expired ticket)
 *   MINUS devices with completed pickup tickets (marked recovered in system)
 */

function computeExpectedList(partnerId, db) {
  const dispatched = db.dispatchByPartner.get(partnerId) || [];
  const expected = [];

  for (const dev of dispatched) {
    const state   = db.stateByDevice.get(dev.device_id) || 'unknown';
    const tickets = db.ticketsByDevice.get(dev.device_id) || [];

    // Returned to warehouse → not expected at partner
    if (state === 'at_wiom') continue;

    // Completed pickup ticket → recovered, not expected
    const hasCompleted = tickets.some(t => t.status === 'completed');
    if (hasCompleted) continue;

    // Legitimately at customer on an active plan → not expected at partner
    if (state === 'at_customer') {
      const hasActive = tickets.some(t => t.status === 'active');
      if (hasActive) continue;
      // at_customer but plan expired → grey zone, still expect them
    }

    expected.push({
      device_id: dev.device_id,
      mac_id:    dev.mac_id,
      batch_id:  dev.batch_id,
      dispatch_date: dev.dispatch_date,
      current_state: state,
      grey_zone: state === 'at_customer' && tickets.some(t => t.status === 'expired'),
    });
  }

  return expected;
}

module.exports = { computeExpectedList };
