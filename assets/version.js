// Which 3D gallery opens: v2 (WebGPU, the default) or the classic v1 (WebGL, 3d.html).
// The visitor's choice is kept in localStorage 'kosno-3d'; without WebGPU only v1 can run.
const KEY = 'kosno-3d';

export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;

export function getVersion(){
  let v = 'v2';
  try { if(localStorage.getItem(KEY) === 'v1') v = 'v1'; } catch(_){}
  return hasWebGPU() ? v : 'v1';
}
export function setVersion(v){
  try { localStorage.setItem(KEY, v); } catch(_){}
}
/* link into the chosen gallery from a page in the site root (index.html): qs like '?sala=3' */
export function galleryHref(qs = '', version = getVersion()){
  return version === 'v1' ? '3d.html' + (qs ? qs + '&legacy=1' : '?legacy=1') : 'v2/' + qs;
}
