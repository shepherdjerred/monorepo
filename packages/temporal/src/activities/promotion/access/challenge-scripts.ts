/** Capture only Turnstile challenge arguments and keep the callback inside the page. */
export const installChallengeCapture = `(() => {
  if (window.__stormCaptchaCapture) return true;
  const state = {challenge:null,callback:null};
  Object.defineProperty(window,'__stormCaptchaCapture',{value:state,configurable:true});
  const wrap = api => {
    if (!api || typeof api.render !== 'function' || api.render.__stormWrapped) return api;
    const original = api.render;
    function render(container, options) {
      state.challenge = {type:'TurnstileTaskProxyless',websiteKey:options.sitekey,...(options.action===undefined?{}:{action:options.action}),...(options.cData===undefined?{}:{cData:options.cData}),...(options.chlPageData===undefined?{}:{chlPageData:options.chlPageData})};
      state.callback = typeof options.callback === 'function' ? options.callback : null;
      return Reflect.apply(original,this,arguments);
    }
    Object.defineProperty(render,'__stormWrapped',{value:true});
    api.render = render;
    return api;
  };
  const descriptor = Object.getOwnPropertyDescriptor(window,'turnstile');
  if (descriptor && !descriptor.configurable) { wrap(window.turnstile); return true; }
  let api = wrap(window.turnstile);
  Object.defineProperty(window,'turnstile',{configurable:true,get:()=>api,set:value=>{api=wrap(value);}});
  return true;
})()`;

export const readChallenge = `(() => {
  const captured=window.__stormCaptchaCapture?.challenge;
  if(captured) return captured;
  const e=document.querySelector('.g-recaptcha[data-sitekey],.cf-turnstile[data-sitekey]');
  if(!e) throw new Error('CAPTCHA parameters unavailable: managed challenges require capture before Turnstile render');
  return {type:e.classList.contains('cf-turnstile')?'TurnstileTaskProxyless':'RecaptchaV2TaskProxyless',websiteKey:e.getAttribute('data-sitekey'),...(e.getAttribute('data-action')?{action:e.getAttribute('data-action')}:{})};
})()`;

/** Only a captured Cloudflare interstitial callback may run; form callbacks stay untouched. */
export function applyCloudflareChallenge(token: string): string {
  return `(() => {
    const state=window.__stormCaptchaCapture;
    if (!state?.challenge?.chlPageData || typeof state.callback !== 'function' || !window._cf_chl_opt || !/just a moment|checking your browser|attention required/i.test(document.title) || document.querySelector('textarea,input[type="password"],[contenteditable="true"]'))
      throw new Error('Captured Cloudflare challenge callback is unavailable');
    const callback=state.callback;
    state.callback=null;
    state.challenge=null;
    callback(${JSON.stringify(token)});
    return true;
  })()`;
}
