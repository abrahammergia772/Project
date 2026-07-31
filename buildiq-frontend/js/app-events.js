/* ============================================================
   BuildIQ — app-events.js

   Audit-trail and notification side-effects.

   Pages used to call `MockData.logAuditEvent(...)` and
   `MockData.addNotification(...)` directly after every mutation. Against a
   real backend that is wrong twice over:

     1. The server ALREADY records an audit entry and pushes notifications
        inside the same request (see app/deps.py: record_audit,
        push_notification). Writing a second, client-side entry produced a
        duplicate that existed only in browser memory and vanished on reload.

     2. The client-side entry was fabricated -- it invented an anomaly score
        with Math.random() -- so the audit log mixed real server rows with
        made-up ones.

   So in live mode these are no-ops: the server is the single source of truth.
   In MOCK_MODE they still drive MockData, which is what makes the offline
   demo feel alive.
   ============================================================ */

const AppEvents = (() => {

  const isMock = () => typeof BUILDIQ_CONFIG !== "undefined" && BUILDIQ_CONFIG.MOCK_MODE;

  /**
   * Record that something happened.
   * Live mode: no-op -- the API call that triggered this already logged it.
   */
  function logAudit(actor, action, resource, meta = {}) {
    if (!isMock()) return null;
    return MockData.logAuditEvent(actor, action, resource, meta);
  }

  /**
   * Raise a notification.
   * Live mode: no-op -- the server fans these out to the right recipients.
   */
  function notify(payload) {
    if (!isMock()) return null;
    return MockData.addNotification(payload);
  }

  /**
   * After a mutation, drop the cached collections it invalidated so the next
   * read re-fetches from the server instead of showing stale rows.
   */
  function invalidate(...collections) {
    if (typeof DataStore !== "undefined") DataStore.invalidate(...collections);
  }

  return { logAudit, notify, invalidate };
})();

if (typeof window !== "undefined") window.AppEvents = AppEvents;
