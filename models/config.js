// Same-origin server previews use a relative API; GitHub Pages uses the public HTTPS endpoint.
window.MOLECULAR_DEMO_API_BASE = location.hostname.endsWith("github.io") ? "https://organizing-fixes-reason-issues.trycloudflare.com" : "";
