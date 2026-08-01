/* ============================================================
   BuildIQ — avatars.js

   Renders profile photos everywhere, not just on the Settings page.

   Why this file exists
   --------------------
   Uploading a photo used to change one <img> on the Settings tab and nothing
   else. The bytes reached the server, but no other part of the UI ever asked
   for them, so as soon as the page was left the initials came back and the
   photo looked "not saved". It was saved -- it was simply never read.

   Reading it is not as simple as `<img src=".../avatar">` because that
   endpoint requires an Authorization header (photos are private, like every
   other read in this API). A plain <img> cannot send one. So each photo is
   fetched with fetch(), turned into an object URL once, cached for the life
   of the page, and swapped into every avatar placeholder carrying that
   member id.
   ============================================================ */

const Avatars = (() => {

  // memberId -> object URL (resolved), or a Promise while in flight, or
  // `null` once we know that member has no photo (so we stop asking).
  const cache = new Map();

  function isLoggedIn() {
    try { return !!(window.Auth && Auth.getToken()); } catch (e) { return false; }
  }

  /** Fetch one member's photo. Resolves to an object URL, or null if none. */
  function load(memberId) {
    if (!memberId || !isLoggedIn()) return Promise.resolve(null);
    if (cache.has(memberId)) return Promise.resolve(cache.get(memberId));

    const pending = fetch(API.avatarUrl(memberId), {
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
    })
      .then(res => (res.ok ? res.blob() : null))
      .then(blob => {
        // A 404 is the normal answer for "no photo set" -- cache the miss so
        // a directory of 200 people does not re-request 200 times.
        const url = blob ? URL.createObjectURL(blob) : null;
        cache.set(memberId, url);
        return url;
      })
      .catch(() => { cache.set(memberId, null); return null; });

    cache.set(memberId, pending);
    return pending;
  }

  /**
   * Swap initials for the real photo on every placeholder inside `root`.
   * Safe to call as often as you like: each element is only processed once.
   */
  function hydrate(root = document) {
    if (!root || !root.querySelectorAll) return;
    const nodes = Array.from(root.querySelectorAll("[data-avatar-id]"));
    if (root.matches && root.matches("[data-avatar-id]")) nodes.push(root);

    nodes.forEach(el => {
      if (el.dataset.avatarDone === "1") return;
      el.dataset.avatarDone = "1";
      const id = el.dataset.avatarId;
      // `has-avatar=0` means the server already told us there is no photo,
      // so we skip the request entirely.
      if (!id || el.dataset.hasAvatar === "0") return;

      Promise.resolve(load(id)).then(url => {
        if (!url || !el.isConnected) return;
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.classList.add("avatar-photo");
        el.textContent = "";
      });
    });
  }

  /**
   * Called after an upload: drop the stale copy and re-render placeholders.
   * Without this the old photo (or the initials) would stay until reload.
   */
  function invalidate(memberId) {
    const old = cache.get(memberId);
    if (typeof old === "string") URL.revokeObjectURL(old);
    cache.delete(memberId);
    document.querySelectorAll(`[data-avatar-id="${CSS.escape(memberId)}"]`).forEach(el => {
      el.dataset.avatarDone = "";
      el.dataset.hasAvatar = "1";
    });
    hydrate(document);
  }

  /** Signing out must not leak one user's photos into the next session. */
  function clear() {
    cache.forEach(v => { if (typeof v === "string") URL.revokeObjectURL(v); });
    cache.clear();
  }

  function init() {
    if (typeof document === "undefined") return;
    hydrate(document);
    // Pages render their HTML after this file loads, and the SPA swaps whole
    // pages in, so watch for new placeholders instead of hydrating once.
    if (typeof MutationObserver === "undefined" || !document.body) return;
    new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1) hydrate(n);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  return { load, hydrate, invalidate, clear, init, cache };
})();

if (typeof window !== "undefined") window.Avatars = Avatars;
