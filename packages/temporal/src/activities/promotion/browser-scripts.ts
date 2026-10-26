/** Stages the solver response without auto-submitting a page. */
export function captchaApplicationScript(token: string): string {
  return `(() => {
    const nodes=document.querySelectorAll('[name="g-recaptcha-response"],[name="cf-turnstile-response"]');
    if(!nodes.length) throw new Error('CAPTCHA response field missing');
    for(const e of nodes) e.value=${JSON.stringify(token)};
    return true;
  })()`;
}
