(function () {
  var currentScript = document.currentScript;
  if (!(currentScript instanceof HTMLScriptElement)) {
    return;
  }

  var siteId = currentScript.dataset["matomoSiteId"];
  if (siteId === undefined) {
    return;
  }

  var queue = (window._paq = window._paq || []);
  queue.push(["disableCookies"]);
  queue.push(["setDoNotTrack", true]);
  queue.push(["setTrackerUrl", "https://matomo.sjer.red/matomo.php"]);
  queue.push(["setSiteId", siteId]);
  queue.push(["trackPageView"]);
  queue.push(["enableLinkTracking"]);

  var matomoScript = document.createElement("script");
  matomoScript.async = true;
  matomoScript.src = "https://matomo.sjer.red/matomo.js";
  document.head.appendChild(matomoScript);
})();
