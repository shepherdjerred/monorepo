// Add Plausible analytics script
const script = document.createElement("script");
script.defer = true;
script.dataset.domain = "webring.sjer.red";
script.src = "https://plausible.sjer.red/js/script.js";
document.head.appendChild(script);
