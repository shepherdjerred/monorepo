// Add the Matomo analytics script.
window._paq = window._paq || [];
window._paq.push(["disableCookies"]);
window._paq.push(["setDoNotTrack", true]);
window._paq.push(["setTrackerUrl", "https://matomo.sjer.red/matomo.php"]);
window._paq.push(["setSiteId", 3]);
window._paq.push(["trackPageView"]);
window._paq.push(["enableLinkTracking"]);

const script = document.createElement("script");
script.async = true;
script.src = "https://matomo.sjer.red/matomo.js";
document.head.appendChild(script);
