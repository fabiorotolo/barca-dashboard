// ========================
// BARRA PULSANTI COMUNE (in basso a destra) per Meteo e Barca
// ========================
// File identico in meteo-dashboard e barca-dashboard. Uso:
//   <script src="nav.js" data-repo="meteo" data-pagina="energia" data-dove=".footer-right"></script>
// data-repo:    "meteo" o "barca" (il sito della pagina)
// data-pagina:  pagina attuale, che non compare tra i pulsanti
// data-dove:    contenitore a cui aggiungere i pulsanti (se manca: barra fissa in basso a destra)
(function () {
  const SITI = {
    meteo: "https://fabiorotolo.github.io/meteo-dashboard/",
    barca: "https://fabiorotolo.github.io/barca-dashboard/"
  };
  const PAGINE = [
    { id: "meteo",     repo: "meteo", file: "index.html",     testo: "🌤 Meteo" },
    { id: "confronto", repo: "meteo", file: "confronto.html", testo: "Confronto" },
    { id: "dati",      repo: "meteo", file: "dati.html",      testo: "Dati" },
    { id: "energia",   repo: "meteo", file: "energia.html",   testo: "⚡ Consumi" },
    { id: "barca",     repo: "barca", file: "index.html",     testo: "⚓ Barca" },
    { id: "comandi",   repo: "barca", file: "consumi.html",   testo: "🔧 Comandi barca" }
  ];

  const s = document.currentScript;
  const repo = s.dataset.repo, qui = s.dataset.pagina;

  if (!document.getElementById("nav-stile")) {
    const st = document.createElement("style");
    st.id = "nav-stile";
    st.textContent =
      ".navbtn{padding:3px 8px;border-radius:6px;border:1px solid #383f53;background:#161c2b;color:#c7cbd6;" +
      "font:11px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;text-decoration:none;display:inline-block;white-space:nowrap}" +
      ".navbtn:hover{border-color:#3d7cff;color:#fff}" +
      ".nav-comune{display:flex;justify-content:flex-end;align-items:center;gap:4px;flex-wrap:wrap}" +
      ".nav-fissa{position:fixed;right:10px;bottom:8px;z-index:900;background:rgba(15,18,26,.85);padding:4px;border-radius:8px}";
    document.head.appendChild(st);
  }

  let box = s.dataset.dove ? document.querySelector(s.dataset.dove) : null;
  if (!box) {
    box = document.createElement("div");
    box.className = "nav-fissa";
    document.body.appendChild(box);
  }
  box.classList.add("nav-comune");

  for (const p of PAGINE) {
    if (p.id === qui) continue;
    const a = document.createElement("a");
    a.className = "navbtn";
    // stesso sito: link relativo (funziona anche in locale sul kiosk); altro sito: indirizzo completo
    a.href = p.repo === repo ? p.file : SITI[p.repo] + p.file;
    a.textContent = p.testo + " ➜";
    box.appendChild(a);
  }

  const esci = document.createElement("button");
  esci.type = "button";
  esci.className = "navbtn";
  esci.title = "Esci da Meteo e Barca su questo dispositivo";
  esci.textContent = "🔒 Esci";
  esci.addEventListener("click", () => cassaforteEsci());
  box.appendChild(esci);
})();
