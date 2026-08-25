import { scoutThemes } from "#src/generated/tokens.ts";

const canvasByTheme = {
  "modern-light": scoutThemes["modern-light"].colors.canvas,
  "modern-dark": scoutThemes["modern-dark"].colors.canvas,
  "classic-light": scoutThemes["classic-light"].colors.canvas,
  "classic-dark": scoutThemes["classic-dark"].colors.canvas,
};

export const SCOUT_THEME_BOOTSTRAP_SCRIPT = `(function(){var d={version:1,skin:"modern",mode:"system"};try{var s=localStorage.getItem("scout-theme-v1"),p=null;if(s){try{var j=JSON.parse(s);if(j&&j.version===1&&(j.skin==="modern"||j.skin==="classic")&&(j.mode==="system"||j.mode==="light"||j.mode==="dark")){p=j;}}catch(e){}}if(!p){var a=localStorage.getItem("scout-app-theme"),m=localStorage.getItem("theme"),v=a==="system"||a==="light"||a==="dark"?a:m==="system"||m==="light"||m==="dark"?m:null;if(v){p={version:1,skin:"modern",mode:v};localStorage.setItem("scout-theme-v1",JSON.stringify(p));localStorage.removeItem("scout-app-theme");localStorage.removeItem("theme");}}d=p||d;}catch(e){}var r=d.mode==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):d.mode,e=document.documentElement;e.setAttribute("data-scout-skin",d.skin);e.setAttribute("data-scout-mode",r);e.setAttribute("data-theme",r);if(r==="dark"){e.classList.add("dark");}else{e.classList.remove("dark");}var C=${JSON.stringify(canvasByTheme)};var color=C[d.skin+"-"+r];if(color&&document.head){var t=document.querySelector('meta[name="theme-color"]');if(!t){t=document.createElement("meta");t.setAttribute("name","theme-color");document.head.appendChild(t);}t.setAttribute("content",color);}})();`;
