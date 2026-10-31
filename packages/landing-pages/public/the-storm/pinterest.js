(function () {
  if (
    window.location.hostname !== "public.ts-mc.net" ||
    !window.location.pathname.startsWith("/the-storm/") ||
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

  function eventId() {
    return window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  // One lead per visit: copying an address is the join intent the campaign
  // optimizes for.
  var sentJoinIntent = false;
  document.addEventListener("storm:server-address-copied", function (event) {
    if (event.detail.field !== "address" || sentJoinIntent) return;
    sentJoinIntent = true;
    window.pintrk("track", "lead", {
      lead_type: "storm_server_address_copied",
      edition: event.detail.edition,
      event_id: eventId(),
    });
  });

  var sentDiscord = false;
  document.addEventListener("storm:discord-clicked", function () {
    if (sentDiscord) return;
    sentDiscord = true;
    window.pintrk("track", "custom", {
      event_name: "storm_discord_clicked",
      event_id: eventId(),
    });
  });
})();
