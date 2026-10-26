/** Fixed DOM inspection only. Agent input is never evaluated as JavaScript. */
export const PROMOTION_CONTROLS_SCRIPT = `Array.from(document.querySelectorAll('input:not([type=hidden]),textarea,select,button,a[href]'))
  .filter(e => e.getClientRects().length).slice(0,400).map(e => {
    const parts=[];
    let node=e;
    while(node && node.nodeType===1) {
      if(node.id) { parts.unshift('#'+CSS.escape(node.id)); break; }
      const tag=node.tagName.toLowerCase();
      const siblings=Array.from(node.parentElement?.children||[]).filter(s=>s.tagName===node.tagName);
      parts.unshift(tag+':nth-of-type('+(siblings.indexOf(node)+1)+')');
      node=node.parentElement;
    }
    return {selector:parts.join(' > '),tag:e.tagName.toLowerCase(),type:e.type||'',name:e.name||'',
      label:(e.innerText||e.getAttribute('aria-label')||(e.type==='submit'?e.value:'')||e.name||'').slice(0,200),href:e.href||''};
  })`;

/** Do not dispatch callbacks/events here: they can auto-submit before publish. */
export function captchaApplicationScript(token: string): string {
  return `(() => {
    const nodes=document.querySelectorAll('[name="g-recaptcha-response"],[name="cf-turnstile-response"]');
    if(!nodes.length) throw new Error('CAPTCHA response field missing');
    for(const e of nodes) e.value=${JSON.stringify(token)};
    return true;
  })()`;
}
