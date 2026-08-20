(function () {
  var currentScript = document.currentScript;
  if (!(currentScript instanceof HTMLScriptElement)) return;

  var projectToken = currentScript.dataset["posthogProjectToken"];
  var apiHost = currentScript.dataset["posthogApiHost"];
  var assetHost = currentScript.dataset["posthogAssetHost"];
  var siteKey = currentScript.dataset["posthogSiteKey"];
  var siteDomain = currentScript.dataset["posthogSiteDomain"];
  var sessionReplay = currentScript.dataset["posthogSessionReplay"];
  if (
    !projectToken ||
    apiHost !== "https://us.i.posthog.com" ||
    assetHost !== "https://us-assets.i.posthog.com" ||
    !siteKey ||
    !siteDomain ||
    (sessionReplay !== "true" && sessionReplay !== "false")
  ) {
    return;
  }

  var captureConfig = {
    autocapture: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_heatmaps: true,
    capture_dead_clicks: true,
    capture_performance: { web_vitals: true, network_timing: true },
    session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: sessionReplay !== "true",
  };

  function parseSession(payload) {
    if (payload === null || typeof payload !== "object") return undefined;
    var result = payload["result"];
    if (result === null || typeof result !== "object") return undefined;
    var data = result["data"];
    if (data === null || typeof data !== "object") return undefined;
    var user = data["user"];
    if (user === null) return { analyticsUserId: null };
    if (typeof user !== "object") return undefined;
    var analyticsUserId = user["analyticsUserId"];
    if (typeof analyticsUserId !== "string" || analyticsUserId.length === 0) {
      return undefined;
    }
    return { analyticsUserId: analyticsUserId };
  }

  function reconcileIdentity(posthog, session) {
    if (session.analyticsUserId === null) {
      if (posthog._isIdentified()) posthog.reset();
      return;
    }
    if (posthog._isIdentified()) {
      if (posthog.get_distinct_id() === session.analyticsUserId) return;
      posthog.reset();
    }
    posthog.identify(session.analyticsUserId);
  }

  !(function (t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
      (e._i = []),
      (e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split(".");
          (2 == o.length && ((t = t[o[0]]), (e = o[1])),
            (t[e] = function () {
              t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
            }));
        }
        (((p = t.createElement("script")).type = "text/javascript"),
          (p.crossOrigin = "anonymous"),
          (p.async = !0),
          (p.src =
            s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") +
            "/static/array.js"),
          (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(
            p,
            r,
          ));
        var u = e;
        for (
          void 0 !== a ? (u = e[a] = []) : (a = "posthog"),
            u.people = u.people || [],
            u.toString = function (t) {
              var e = "posthog";
              return (
                "posthog" !== a && (e += "." + a),
                t || (e += " (stub)"),
                e
              );
            },
            u.people.toString = function () {
              return u.toString(1) + ".people (stub)";
            },
            o =
              "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(
                " ",
              ),
            n = 0;
          n < o.length;
          n++
        )
          g(u, o[n]);
        e._i.push([i, s, a]);
      }),
      (e.__SV = 1));
  })(document, window.posthog || []);

  window.posthog.init(projectToken, {
    api_host: apiHost,
    asset_host: assetHost,
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    // Automatic sources start disabled. The public marketing shell shares
    // PostHog storage with `/app`, so SDK initialisation must not let a stored
    // opt-in attribute this page to a stale signed-in person.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    respect_dnt: true,
    person_profiles: "always",
    session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: false,
    loaded: async function (posthog) {
      posthog.opt_out_capturing();
      posthog.unregister_for_session("guild_id");
      // Once capture is explicitly closed, start the high-fidelity collectors.
      // Their events remain suppressed until session reconciliation opts in.
      posthog.set_config(captureConfig);

      var response;
      try {
        response = await window.fetch("/trpc/auth.sessionState", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
      } catch {
        return;
      }
      if (!response.ok) return;

      var payload;
      try {
        payload = await response.json();
      } catch {
        return;
      }
      var session = parseSession(payload);
      if (session === undefined) return;

      reconcileIdentity(posthog, session);
      // `reset()` also clears registered properties, so restore site identity
      // after reconciliation and only then enable capture. PostHog's opt-in
      // path emits the initial pageview with the now-current identity.
      posthog.unregister_for_session("guild_id");
      posthog.register({
        site_key: siteKey,
        site_hostname: siteDomain,
      });
      posthog.opt_in_capturing({ captureEventName: false });
    },
  });
  // Returning visitors can carry a stored opt-in, so the default above is not
  // enough on its own. This queued call closes manual capture before the SDK
  // finishes loading; `loaded` closes it again before enabling collectors.
  window.posthog.opt_out_capturing();
})();
