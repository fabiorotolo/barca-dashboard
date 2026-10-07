// ========================
// CASSAFORTE: una password per tutte le dashboard
// ========================
// Le Read API Key ThingSpeak stanno in chiavi-cifrate.js, cifrate con AES-GCM
// (chiave ricavata dalla password con PBKDF2-SHA256). Senza password sono illeggibili.
// La password si inserisce una volta per dispositivo e per sito (barca su github.io, meteo su
// vercel.app sono siti diversi per il browser): le chiavi decifrate vengono salvate nel browser.
// File identico nei due repository. Per cambiare chiavi o password: cifra-chiavi.html

const CASSAFORTE_BARCA = "barca-read-key";     // usata da barca-dashboard
const CASSAFORTE_METEO = "meteo-read-keys";    // usata da meteo-dashboard ({int, ext, energia})

const b64dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64enc = a => btoa(String.fromCharCode(...new Uint8Array(a)));

async function cassaforteChiave(password, salt, iter, uso) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, [uso]);
}

// password + oggetto chiavi -> contenuto cifrato (usato da cifra-chiavi.html)
async function cassaforteCifra(password, chiavi, iter = 600000) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await cassaforteChiave(password, salt, iter, "encrypt");
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(chiavi)));
  return { v: 1, iter, salt: b64enc(salt), iv: b64enc(iv), data: b64enc(data) };
}

// password -> chiavi in chiaro; errore se la password è sbagliata
async function cassaforteApri(password) {
  const c = CHIAVI_CIFRATE;
  const k = await cassaforteChiave(password, b64dec(c.salt), c.iter, "decrypt");
  const chiaro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(c.iv) }, k, b64dec(c.data));
  return JSON.parse(new TextDecoder().decode(chiaro));
}

function cassaforteSalva(k) {
  localStorage.setItem(CASSAFORTE_BARCA, k.barca || "");
  localStorage.setItem(CASSAFORTE_METEO, JSON.stringify({ int: k.int || "", ext: k.ext || "", energia: k.energia || "" }));
}

function cassaforteEsci() {
  try { localStorage.removeItem(CASSAFORTE_BARCA); localStorage.removeItem(CASSAFORTE_METEO); } catch (e) {}
  location.replace(location.pathname);
}

// finestra password: se giusta salva le chiavi e ricarica la pagina
function cassaforteForm(msg) {
  if (document.getElementById("cassaforte")) return;
  const d = document.createElement("div");
  d.id = "cassaforte";
  d.style.cssText = "position:fixed;inset:0;background:rgba(8,10,16,.93);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif";
  d.innerHTML = `
    <form style="background:#1f2330;border:1px solid #3a3f4d;border-radius:12px;padding:18px;width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px;color:#f4f4f7">
      <div style="font-size:18px;font-weight:700">🔒 Accesso riservato</div>
      <div style="font-size:13px;color:#9aa0b0;line-height:1.4">${msg || "Inserisci la password delle dashboard. Basta una volta su questo dispositivo (è la stessa per Barca e Meteo)."}</div>
      <input type="password" autocomplete="current-password" required placeholder="Password"
        style="background:#12141b;color:#fff;border:1px solid #3a3f4d;border-radius:7px;padding:10px;font-size:15px">
      <div class="err" style="display:none;font-size:13px;color:#ff7b7b">Password errata.</div>
      <button type="submit" style="background:#3d7cff;border:0;color:#fff;border-radius:7px;padding:10px 12px;font-size:15px;cursor:pointer">Entra</button>
    </form>`;
  document.body.appendChild(d);
  const input = d.querySelector("input"), err = d.querySelector(".err"), btn = d.querySelector("button");
  d.querySelector("form").addEventListener("submit", async ev => {
    ev.preventDefault();
    btn.disabled = true; btn.textContent = "Verifica…"; err.style.display = "none";
    try {
      cassaforteSalva(await cassaforteApri(input.value));
      location.reload();
    } catch (e) {
      err.style.display = "block"; btn.disabled = false; btn.textContent = "Entra"; input.select();
    }
  });
  input.focus();
}
