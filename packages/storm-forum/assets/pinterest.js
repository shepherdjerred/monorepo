(function () {
  if (
    window.location.hostname !== "ts-mc.net" ||
    navigator.doNotTrack === "1" ||
    navigator.globalPrivacyControl === true
  )
    return;

  // The Storm shares Scout's advertiser account and its public Pinterest tag.
  if (!window.pintrk) {
    window.pintrk = function () {
      window.pintrk.queue.push(Array.prototype.slice.call(arguments));
    };
    window.pintrk.queue = [];
    window.pintrk.version = "3.0";
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://s.pinimg.com/ct/core.js";
    var firstScript = document.getElementsByTagName("script")[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }
  window.pintrk("load", "2612722784413");
  window.pintrk("page");
  window.pintrk("track", "pagevisit");

  var sentJoinIntent = false;
  document.addEventListener("storm:server-address-copied", function (event) {
    if (event.detail.field !== "address" || sentJoinIntent) return;
    sentJoinIntent = true;
    var eventId =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    window.pintrk("track", "lead", {
      lead_type: "storm_server_address_copied",
      edition: event.detail.edition,
      event_id: eventId,
    });
  });
})();
