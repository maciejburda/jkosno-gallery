// Baner zgody (Consent Mode v2). Decyzja trzymana w localStorage 'kosno-consent'
// i wspólna dla całej witryny; domyślne 'denied' ustawia snippet w <head>.
const KEY = 'kosno-consent';

const CSS = `
#consentbar{position:fixed;left:50%;transform:translateX(-50%);z-index:70;
  bottom:calc(14px + env(safe-area-inset-bottom));width:min(680px, calc(100vw - 24px));
  background:linear-gradient(160deg, rgba(38,30,24,.97), rgba(26,20,16,.97));
  border:1px solid rgba(231,214,189,.22);border-radius:16px;padding:16px 18px;
  box-shadow:0 18px 50px rgba(0,0,0,.55);backdrop-filter:blur(10px);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#consentbar p{margin:0 0 12px;font-size:13px;line-height:1.6;color:#b3a394}
#consentbar .cbtns{display:flex;gap:10px;flex-wrap:wrap}
#consentbar button{border-radius:999px;padding:10px 22px;font-size:13.5px;font-weight:600;
  cursor:pointer;font-family:inherit}
#consentbar .c-acc{border:0;color:#241a0a;background:linear-gradient(140deg,#eabb74,#e0a050)}
#consentbar .c-acc:hover{filter:brightness(1.06)}
#consentbar .c-den{border:1px solid rgba(231,214,189,.26);background:rgba(34,27,22,.4);color:#f4ecdf}
#consentbar .c-den:hover{background:rgba(34,27,22,.85)}
`;

function applyConsent(v){
  try{
    window.gtag?.('consent', 'update', {
      ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v,
    });
  }catch(_){}
}

export function initConsentBanner(t){
  try{ if(localStorage.getItem(KEY)) return; }catch(_){ return; }
  if(document.getElementById('consentbar')) return;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const bar = document.createElement('div');
  bar.id = 'consentbar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-live', 'polite');
  bar.innerHTML = `<p>${t('consentText')}</p>
    <div class="cbtns">
      <button class="c-acc" type="button">${t('consentAccept')}</button>
      <button class="c-den" type="button">${t('consentDeny')}</button>
    </div>`;
  document.body.appendChild(bar);
  const done = v => {
    try{ localStorage.setItem(KEY, v); }catch(_){}
    applyConsent(v);
    bar.remove();
  };
  bar.querySelector('.c-acc').addEventListener('click', () => done('granted'));
  bar.querySelector('.c-den').addEventListener('click', () => done('denied'));
}

/* ponowne otwarcie baneru (link „Ustawienia prywatności") */
export function resetConsent(t){
  try{ localStorage.removeItem(KEY); }catch(_){}
  applyConsent('denied');
  initConsentBanner(t);
}
