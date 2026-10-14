/** Next SPA links do not trigger beforeunload. Guard them before their handlers run. */
export function installDocumentLeaveGuard(isPending: () => boolean, confirmLeave: () => boolean,
  target: Document = document, browser: Window = window) {
  function anchorClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const source = event.target;
    const anchor = source instanceof Element ? source.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;
    const destination = new URL(anchor.href, browser.location.href);
    if (destination.pathname === browser.location.pathname && destination.search === browser.location.search) return;
    if (isPending() && !confirmLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function submit(event: SubmitEvent) {
    // Covers logout/server-action forms in the app header, not document actions.
    if (!(event.target instanceof Element) || event.target.closest("[data-document-workspace]")) return;
    if (isPending() && !confirmLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  target.addEventListener("click", anchorClick, true);
  target.addEventListener("submit", submit, true);
  return () => { target.removeEventListener("click", anchorClick, true); target.removeEventListener("submit", submit, true); };
}
