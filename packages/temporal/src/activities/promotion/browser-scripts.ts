/** Detects supported widgets without disclosing challenge metadata or tokens. */
export const captchaChallengePresent = `Boolean(window.__stormCaptchaCapture?.challenge || document.querySelector('.g-recaptcha[data-sitekey],.cf-turnstile[data-sitekey]'))`;

/** Reports readiness without returning a private CAPTCHA response. */
export const captchaResponsePresent = `(() => {
  const fields=Array.from(document.querySelectorAll('[name="g-recaptcha-response"],[name="cf-turnstile-response"]'));
  return fields.length>0 && fields.every(e=>typeof e.value==='string' && e.value.trim().length>0);
})()`;

/** Stages the solver response without auto-submitting a page. */
export function captchaApplicationScript(token: string): string {
  return `(() => {
    const nodes=document.querySelectorAll('[name="g-recaptcha-response"],[name="cf-turnstile-response"]');
    if(!nodes.length) throw new Error('CAPTCHA response field missing');
    for(const e of nodes) e.value=${JSON.stringify(token)};
    return true;
  })()`;
}
