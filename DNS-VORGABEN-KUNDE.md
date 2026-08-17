# DNS-Vorgaben — Pizzeria Valenio

**Für:** Domain-Inhaber der Domain `valenio-restaurant.de` (registriert bei **IONOS**)
**Zweck:** Die neue Website soll unter der eigenen Domain erreichbar sein.
**Stand:** 12.08.2026

---

## Kurzfassung

Es werden **nur drei Dinge** verändert:

1. Der `A`-Eintrag der Hauptdomain zeigt künftig auf den Webserver der neuen Website.
2. Die `AAAA`-Einträge (IPv6) werden gelöscht.
3. `www` bekommt einen `CNAME`-Eintrag.

> ### ⚠️ Wichtig: E-Mail nicht anfassen
> Auf dieser Domain läuft **aktive IONOS-E-Mail** (`mx00.ionos.de` / `mx01.ionos.de`).
> Die Einträge vom Typ **`MX`** und der **`TXT`-Eintrag mit `v=spf1 …`** dürfen
> **nicht verändert oder gelöscht** werden — sonst kommen keine E-Mails mehr an.
> Verändert werden ausschließlich `A`, `AAAA` und `CNAME`.

---

## Die Einträge im Detail

Einzustellen bei IONOS unter **Domains & SSL → `valenio-restaurant.de` → DNS**.

| Aktion | Typ | Name / Host | Wert | TTL |
|---|---|---|---|---|
| **ändern** | `A` | `@` | `216.24.57.1` | 1 Stunde |
| **löschen** | `AAAA` | `@` | (bestehender IPv6-Wert) | — |
| **anlegen** | `CNAME` | `www` | `valenio-live.onrender.com` | 1 Stunde |
| **löschen** | `A` | `www` | (bestehender Wert) | — |
| **löschen** | `AAAA` | `www` | (bestehender IPv6-Wert) | — |
| **unverändert lassen** | `MX` | `@` | `mx00.ionos.de`, `mx01.ionos.de` | ⚠️ nicht anfassen |
| **unverändert lassen** | `TXT` | `@` | `v=spf1 include:_spf-eu.ionos.com ~all` | ⚠️ nicht anfassen |

**Hinweise zu einzelnen Zeilen**

- **`@`** steht bei IONOS für die Domain selbst (`valenio-restaurant.de` ohne Vorsatz).
- Die **`AAAA`-Einträge müssen weg.** Der neue Webserver ist ausschließlich über IPv4
  erreichbar. Bleibt ein IPv6-Eintrag stehen, landen moderne Geräte weiterhin auf der
  alten Seite — der häufigste Fehler bei solchen Umstellungen.
- Bei `www` müssen die vorhandenen `A`/`AAAA`-Einträge **zuerst gelöscht** werden.
  Ein `CNAME` kann technisch nicht neben einem `A`-Eintrag für denselben Namen bestehen.
- Der Wert `valenio-live.onrender.com` wird final bestätigt, sobald die Website
  eingerichtet ist — bitte vor dem Eintragen kurz gegenprüfen.

---

## Vorher: Verbindung zur IONOS-Platzhalterseite lösen

Die Domain zeigt aktuell auf eine IONOS-Parkseite. Solange die Domain mit einem
IONOS-Produkt „verbunden" ist, sind die DNS-Felder **gesperrt und ausgegraut**.

Zuerst hier lösen:
**Domains & SSL → `valenio-restaurant.de` → Menü (⋮) → Ziel bearbeiten bzw. Verbindung
aufheben** → bestehende Weiterleitung / Produktverknüpfung entfernen.

Danach lassen sich die Einträge oben frei setzen.

---

## Danach

- Das **HTTPS-Zertifikat** (Schloss-Symbol im Browser) wird automatisch erstellt —
  es muss **nichts** bei IONOS bestellt oder eingerichtet werden.
- `www.valenio-restaurant.de` leitet automatisch auf `valenio-restaurant.de` um.
- **Wartezeit:** meist wenige Minuten bis Stunden, im Einzelfall bis zu 48 Stunden,
  bis die Änderung weltweit bekannt ist.
- **Bitte nach der Umstellung kurz testen:** eine E-Mail an die eigene
  `@valenio-restaurant.de`-Adresse schicken und prüfen, ob sie ankommt.

---

## Alternative: Zugang statt Anleitung

Wenn es einfacher ist, können die Einträge auch von uns gesetzt werden. Dafür genügt
ein Zugang zur DNS-Verwaltung der Domain bei IONOS. Die E-Mail-Einstellungen bleiben
dabei unberührt.

*Erstellt von FlueVate*
