# VE.Direct-Schreibfähigkeit und BMV-602S

## Ergebnis

Der Adapter `ioBroker.victron-bmv` bleibt read-only. VE.Direct besitzt bei unterstützten neueren Geräten zwar einen HEX-Modus mit `Get`- und `Set`-Kommandos, diese Fähigkeit darf jedoch nicht auf jedes Victron-Gerät übertragen werden.

Für den produktiv verwendeten **BMV-602S mit Firmware 2.11** gibt es keinen offiziell dokumentierten Schreib- oder Synchronisationsweg über die serielle Text-Schnittstelle.

## Geräteabhängige Einordnung

| Gerät | Offiziell dokumentierte Schnittstelle | Einstellungen schreiben / synchronisieren |
|---|---|---|
| BMV-600S / 602S / 600HS | Eingeschränkter BMV-60xS-Text-Modus | **Nein** |
| BMV-700 / 700H / 702 / 712 | VE.Direct TEXT und gerätespezifisches HEX-Protokoll | **Ja, für dokumentierte schreibbare Register**; modell-/firmwareabhängig |
| SmartShunt | VE.Direct; gerätespezifische Dokumentation und VictronConnect | Grundsätzlich ja, Register und Firmware müssen separat geprüft werden |

Die neuen BMV-/SmartShunt-Handbücher beschreiben bei den unterstützten Geräten die VE.Direct-Schnittstelle ausdrücklich als Möglichkeit, Daten zu lesen und Einstellungen zu ändern. Das ist keine Aussage über die alte BMV-60xS-Serie.

## Belege für den BMV-602S

### VE.Direct Protocol 3.34

Die allgemeine Einführung beschreibt TEXT und HEX einschließlich Schreibzugriffen. Dieselbe Spezifikation grenzt die alte Baureihe jedoch ausdrücklich ein:

> The BMV-60xS does not have a full VE.Direct interface. There is only limited support for the Text-mode.

### Data-Communication-Whitepaper

Die Produkttabelle unterscheidet BMV-60xS Text von echtem VE.Direct bei BMV-700. Im gerätespezifischen Abschnitt steht:

> This protocol only allows reading information from the battery monitor. Setting parameters or ‘synchronizing’ the BMV is not possible.

### BMV-60xS Text Protocol und Firmware 2.11

Das Dokument beschreibt ausschließlich automatisch gesendete Statistikblöcke. Firmware 2.08 führte zusätzliche Textfelder wie `BMV`, `FW` und `AR` ein; eine HEX- oder Schreibunterstützung wird auch für spätere Firmware nicht eingeführt oder dokumentiert. FW 2.11 ist daher keine belegte Ausnahme.

### Product-ID ist kein Schreibnachweis

Das Dokument „BMV700 Series Hex Protocol“ enthält in seiner Product-ID-Tabelle auch `0x0201` für BMV-602S. Diese Zuordnung belegt keine HEX-`Get`/`Set`-Unterstützung und keine schreibbaren Register auf diesem Gerät. Den gerätespezifischen read-only-Aussagen geht der Vorrang.

## Was neuere BMV-Geräte grundsätzlich erlauben

Das BMV-700-HEX-Protokoll dokumentiert unter anderem:

- Batteriekapazität, Charged Voltage, Tail Current, Charge Efficiency und Peukert-Koeffizient,
- Alarm- und Relaisgrenzen,
- Relais-Modus und Relaissteuerung,
- Nullstromkalibrierung und Synchronisierung,
- Display- und AUX-Einstellungen.

Response-Flags unterscheiden unbekannte Register, Read-only-Zugriffe und Parameter-/Bereichsfehler. Registerverfügbarkeit ist teilweise auf BMV-702/712 oder bestimmte Firmwareversionen beschränkt.

## Anforderungen an einen möglichen zukünftigen Schreibsupport

Für ausdrücklich unterstützte neuere Geräte wäre eine separate, standardmäßig deaktivierte Funktion erforderlich:

1. HEX-Request-/Response-Codec mit Little-Endian-Typen und Checksumme `0x55`.
2. Serialisierte Befehlsqueue, korrelate Responses und Timeouts.
3. Geräte-/Firmware-Whitelist mit Register-, Typ- und Bereichsprüfung.
4. `ack=false` beim Benutzerauftrag; `ack=true` erst nach bestätigter Response beziehungsweise Read-after-Write.
5. Berücksichtigung der TEXT-Pausen älterer HEX-Implementationen im Watchdog.
6. Keine allgemeine Freigabe gefährlicher Kommandos wie Restore Defaults, Clear History oder Restart.

Eine solche Erweiterung ist nicht Teil von v0.1.0 und benötigt eigene Tests und Hardwarevalidierung auf einem unterstützten Gerät.

## Alternativen für den vorhandenen BMV-602S

- **Manuell synchronisieren:** Im Normalbetrieb `+` und `–` gleichzeitig für drei Sekunden halten oder im Setup-Modus `SYNC` verwenden.
- **Parameter ändern:** Lokales Setup-Menü am BMV.
- **NMEA-2000-Drop-Cable:** Ermöglicht Datenübertragung sowie Änderungen an Übertragungs-/Netzwerkparametern des Adapters; die Einstellungen des BMV selbst bleiben laut Handbuch unverändert.
- **ioBroker-gestütztes Schreiben:** Erfordert realistischerweise ein unterstütztes neueres Gerät.

## Quellen

- [VE.Direct Protocol 3.34](https://www.victronenergy.com/upload/documents/VE.Direct-Protocol-3.34.pdf)
- [VE.Direct Protocol FAQ](https://www.victronenergy.com/live/vedirect_protocol:faq)
- [BMV700 Series Hex Protocol](https://www.victronenergy.com/upload/documents/BMV-7xx-HEX-Protocol.pdf)
- [BMV-60xS Text Protocol](https://www.victronenergy.com/upload/documents/BMV-60xS-Text-Protocol.pdf)
- [Data communication with Victron Energy products](https://www.victronenergy.com/upload/documents/Technical-Information-Data-communication-with-Victron-Energy-products_EN.pdf)
- [BMV-600S/600HS/602S Handbuch](https://www.victronenergy.com/upload/documents/Manual-BMV-600S-600HS-602S-EN-NL-FR-DE-ES-SE-IT-PT.pdf)
- [BMV NMEA 2000 Handbuch](https://www.victronenergy.com/upload/documents/Manual-BMV-NMEA-2000-EN.pdf)
- [BMV-700 – Custom integration](https://www.victronenergy.com/media/pg/BMV-700/en/interfacing.html)
- [BMV-712 Smart – Custom integration](https://www.victronenergy.com/media/pg/BMV-712_Smart/en/interfacing.html)
- [SmartShunt – Custom integration](https://www.victronenergy.com/media/pg/SmartShunt/en/interfacing.html)

## Nachweisgrenze

Die Recherche erfolgte ausschließlich anhand der Dokumentation. Es wurden keine HEX-Schreib-, Konfigurations-, Restart- oder Synchronisationsbefehle an den pi3 oder das reale BMV gesendet.
