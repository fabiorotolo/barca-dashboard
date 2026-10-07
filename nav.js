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
  const PAGINE = {
    meteo:     { repo: "meteo", file: "index.html",     testo: "🌤 Meteo" },
    confronto: { repo: "meteo", file: "confronto.html", testo: "Confronto" },
    dati:      { repo: "meteo", file: "dati.html",      testo: "Dati" },
    energia:   { repo: "meteo", file: "energia.html",   testo: "⚡ Consumi" },
    barca:     { repo: "barca", file: "index.html",     testo: "⚓ Barca" },
    comandi:   { repo: "barca", file: "consumi.html",   testo: "🔧 Comandi barca" }
  };
  // Barra di ogni pagina, da sinistra a destra, a gruppi (ambienti); Esci si aggiunge sempre in fondo.
  // Le pagine principali (Meteo, Consumi, Barca) sono collegate tra loro, con Meteo ("casa") accanto
  // a Esci; le sotto-pagine portano solo dentro il proprio ambiente.
  const BARRE = {
    meteo:     [["confronto", "dati"], ["energia"], ["barca"]],
    confronto: [["meteo", "dati"]],
    dati:      [["meteo", "confronto"]],
    energia:   [["barca"], ["meteo"]],
    barca:     [["comandi"], ["energia"], ["meteo"]],
    comandi:   [["barca"]]
  };

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
      ".nav-gruppo{display:flex;gap:4px;margin-left:8px}" +
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

  for (const gruppo of BARRE[qui] || []) {
    const g = document.createElement("span");
    g.className = "nav-gruppo";
    for (const id of gruppo) {
      const p = PAGINE[id];
      const a = document.createElement("a");
      a.className = "navbtn";
      // stesso sito: link relativo (funziona anche in locale sul kiosk); altro sito: indirizzo completo
      a.href = p.repo === repo ? p.file : SITI[p.repo] + p.file;
      a.textContent = p.testo + " ➜";
      g.appendChild(a);
    }
    box.appendChild(g);
  }

  const esci = document.createElement("button");
  esci.type = "button";
  esci.className = "navbtn";
  esci.title = "Esci da Meteo e Barca su questo dispositivo";
  esci.textContent = "🔒 Esci";
  esci.addEventListener("click", () => cassaforteEsci());
  const ge = document.createElement("span");
  ge.className = "nav-gruppo";
  ge.appendChild(esci);
  box.appendChild(ge);
})();
