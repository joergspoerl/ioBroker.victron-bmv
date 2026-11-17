![Logo](admin/victron-bmv.png)

# ioBroker.victron-bmv

[![Test and Release](https://github.com/joergoss/ioBroker.victron-bmv/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/joergoss/ioBroker.victron-bmv/actions/workflows/test-and-release.yml)

Read-only ioBroker-Adapter für Victron-BMV-Batteriemonitore und kompatible VE.Direct-Geräte über das serielle **TEXT-Protokoll**.

## Funktionen

- Byteorientierter VE.Direct-Parser mit Modulo-256-Checksumme.
- Sofortiger Frameabschluss direkt nach dem Checksum-Byte, auch ohne zusätzliches CRLF.
- Sichere Behandlung beliebiger Chunk-Grenzen, mehrerer Blöcke und unbekannter Felder.
- Asynchrone HEX-Nachrichten (`:A…LF`) werden erkannt; einen unterbrochenen TEXT-Block verwirft der Parser kontrolliert und resynchronisiert am nächsten Block.
- Atomare Frames: Nur checksumgültige und tatsächlich enthaltene Felder werden publiziert.
- `info.connection` folgt frischen gültigen Daten, nicht nur einem offenen Serial-Port.
- Keine HEX-Schreibbefehle und keine Gerätekonfiguration über diesen Adapter.

## Unterstützte Geräte

Die Feldverfügbarkeit hängt von Modell und Konfiguration ab. Die Felddefinitionen folgen **VE.Direct Protocol 3.34**, insbesondere BMV 60x/70x/71x und SmartShunt.

- BMV-60xS besitzen nur eine eingeschränkte TEXT-Schnittstelle.
- Auxiliary-/Midpoint-/Temperaturfelder hängen von der AUX-Konfiguration ab.
- Nicht synchronisierte oder DC-Monitor-Betriebsarten können statt Zahlen `---` senden.
- MPPT-/Phoenix-/Orion-spezifische Felder sind nicht Ziel dieses BMV-Adapters.

Offizielle Referenzen:

- [VE.Direct Protocol 3.34](https://www.victronenergy.com/upload/documents/VE.Direct-Protocol-3.34.pdf)
- [VE.Direct Protocol FAQ](https://www.victronenergy.com/live/vedirect_protocol:faq)

## Installation und serielle Konfiguration

1. BMV über eine geeignete VE.Direct-/USB- oder VE.Direct-/RS232-Schnittstelle mit dem ioBroker-Host verbinden. Victron empfiehlt Schnittstellen mit galvanischer Isolation.
2. Den Pfad im Admin eintragen, beispielsweise `/dev/ttyUSB0` oder einen stabilen Pfad unter `/dev/serial/by-id/`.
3. Sicherstellen, dass der ioBroker-Prozess auf den Port zugreifen darf.
4. Der Adapter verwendet die protokollkonforme Konfiguration **19200 Baud, 8 Datenbits, keine Parität, 1 Stoppbit** und schreibt keine HEX-Befehle.
5. Vor dem Start darf kein zweiter Prozess denselben Serial-Port verwenden.

## Verbindungs- und Fehlerverhalten

- `info.connection=true`: Innerhalb der letzten fünf Sekunden wurde mindestens ein checksumgültiger Block verarbeitet.
- `info.connection=false`: Kein frischer gültiger Block, Serial-Fehler oder Adapter noch nicht verbunden.
- Ein offener, aber stummer Port wird nicht mehr als verbunden angezeigt, sondern kontrolliert geschlossen und erneut geöffnet.
- Open/Set besitzen ein 10-Sekunden-Timeout, Close ein 5-Sekunden-Timeout; späte Callbacks einer alten Session werden nicht als aktuelle Daten übernommen.
- Beim kontrollierten Adapterstopp wird `info.connection=false` quittiert, bevor der Unload abschließt.
- Ungültige Checksummen, beschädigte Frames und nicht dekodierbare Feldwerte verwerfen den betroffenen Block; unbekannte Felder werden ignoriert. In keinem Fall entstehen erfundene Messwerte.
- States werden nur bei Änderungen geschrieben und erhalten `ack=true`, wenn sie aus einem gültigen Geräteblock stammen.

## Sonderwerte

| Geräteangabe | ioBroker-Verhalten |
|---|---|
| `---` in numerischen Feldern | `null`; kein `NaN` und kein Pseudo-Nullwert |
| `TTG=-1` | `TTG=null`, `TTGInfinite=true` |
| Normales `TTG` in Minuten | Stunden; `TTGInfinite=false` |
| Fehlendes/optionales Feld | Es wird kein State-Wert erzeugt oder mit 0 simuliert |
| `On`/`OFF` in unterschiedlicher Schreibweise | Case-insensitive Boolean-Auswertung |

## Laufzeitfelder

| State | Einheit | Bedeutung / Rohskalierung |
|---|---:|---|
| `V` | V | Hauptbatteriespannung, mV / 1000 |
| `VS` | V | Auxiliary-/Starterspannung, mV / 1000 |
| `I` | A | Vorzeichenbehafteter Batteriestrom, mA / 1000 |
| `P` | W | Momentanleistung, unverändert |
| `CE` | Ah | Verbrauchte Ladung, mAh / 1000 |
| `SOC` | % | State of Charge, Promille / 10 |
| `TTG` | h | Minuten / 60; Sonderwerte siehe oben |
| `TTGInfinite` | – | Synthetischer Status aus `TTG=-1` |
| `Alarm` | – | Alarmzustand |
| `Relay` | – | Relaiszustand |
| `AR` | – | Alarm-Reason-Rohbitfeld |
| `BMV` | – | Modelltext, laut Protokoll deprecated |
| `FW` | – | 16-Bit-Firmwareversion als String |
| `FWE` | – | 24-Bit-Firmwareversion als String |
| `PID` | – | Produkt-ID als String, z. B. `0x203` |
| `SER#` | – | Seriennummer |
| `MON` | – | DC-Monitor-Rohwert |
| `VM` | V | Midpoint-Spannung, mV / 1000 |
| `DM` | % | Midpoint-Abweichung, Promille / 10 |
| `T` | °C | Batterietemperatur oder `null` |

## Historiefelder

| State | Einheit | Bedeutung / Rohskalierung |
|---|---:|---|
| `H1` | Ah | Tiefste Entladung, mAh / 1000 |
| `H2` | Ah | Letzte Entladung, mAh / 1000 |
| `H3` | Ah | Durchschnittliche Entladung, mAh / 1000 |
| `H4` | – | Ladezyklen, unveränderte Ganzzahl |
| `H5` | – | Vollentladungen, unveränderte Ganzzahl |
| `H6` | Ah | Kumulierte entnommene Ladung, mAh / 1000 |
| `H7` | V | Minimale Hauptspannung, mV / 1000 |
| `H8` | V | Maximale Hauptspannung, mV / 1000 |
| `H9` | d | Sekunden seit letzter Volladung / 86400 |
| `H10` | – | Automatische Synchronisationen |
| `H11` | – | Low-Main-Voltage-Alarme |
| `H12` | – | High-Main-Voltage-Alarme |
| `H13` | – | Low-Aux-Voltage-Alarme |
| `H14` | – | High-Aux-Voltage-Alarme |
| `H15` | V | Minimale Auxiliary-Spannung, mV / 1000 |
| `H16` | V | Maximale Auxiliary-Spannung, mV / 1000 |
| `H17` | kWh | Entladene/produzierte Energie, Rohwert × 0.01 |
| `H18` | kWh | Geladene/verbrauchte Energie, Rohwert × 0.01 |

## Mehrere Protokollblöcke

VE.Direct darf Laufzeit- und Historiewerte in unterschiedlichen Blöcken senden. Jeder Block besitzt eine eigene Checksumme. Der Adapter publiziert nur die tatsächlich enthaltenen Felder und verändert keine anderen States. Dadurch bleibt der letzte gültige Wert anderer Blöcke erhalten, ohne fehlende Felder als `0` vorzutäuschen.

Asynchrone HEX-Nachrichten können TEXT-Blöcke unterbrechen. Entsprechend der offiziellen FAQ-Referenz hat im `CHECKSUM`-Zustand das binäre Checksumbyte Vorrang vor einem Doppelpunkt. Ein HEX-unterbrochener TEXT-Block wird nicht publiziert; der Parser resynchronisiert am nächsten vollständigen Block. HEX-Lese-/Schreibkommandos sind außerhalb des Adapterumfangs.

## Migration von 0.0.3

- Bestehende State-Objekte und deren Namen, Rollen und Einheiten werden beim Start automatisch aktualisiert.
- `H4`/`H5` werden als ganzzahlige Zähler und `H6` mit korrekter mAh→Ah-Skalierung aktualisiert.
- `TTG=-1` ersetzt den früheren negativen Stundenwert durch `TTG=null` und `TTGInfinite=true`.
- `H9` bleibt bewusst in Tagen (`unit=d`); die frühere beschreibende `unit` wird korrigiert.
- Bereits in History-Datenbanken gespeicherte Altwerte werden nicht rückwirkend verändert. Neue gültige Geräteblöcke aktualisieren die aktuellen States automatisch.

## Entwicklung und Tests

Der vollständige Audit ist in [docs/audit-2026-11-17.md](docs/audit-2026-11-17.md) dokumentiert.

```bash
npm ci
npm run test:all
```

`test:all` umfasst TypeScript-/Protokoll-/Lifecycle-Tests, Package-Checks, Typecheck, ESLint, Build und js-controller-Integration. Die CI-Matrix deckt Node.js 18, 20, 22, 24 und 26 auf Linux, Windows und macOS ab. Die Tests verwenden offizielle Rohframes, alle Chunk-Grenzen, alle 256 binären Checksum-Werte, Multiblock-Streams, asynchrone HEX-Nachrichten, reale BMV-602S-Produktionsvektoren und SerialPort-Mocks. Reale Hardware oder serielle Native-Treiber sind für die Unit-Tests nicht erforderlich. Die Entwicklungswerkzeuge (ESLint 10) benötigen Node.js ≥ 20.19; die Produktionsunterstützung ab Node.js 18 bleibt davon unberührt.

## Changelog

### **WORK IN PROGRESS**
- (joerg) VE.Direct-Feldskalierung, Metadaten und Sonderwerte korrigiert (#2).
- (joerg) Serial-Watchdog, State-Serialisierung und Unload sicher überarbeitet (#3, #9).
- (joerg) Byteorientierter Parser mit Multiblock-/HEX-/Recovery-Tests neu aufgebaut (#4, #10).
- (joerg) SerialPort 12 mit ARMv7-Prebuilds und Node.js-18-kompatibler Testsuite eingeführt (#6, #8).
- (joerg) Admin, Paket, CI und Dokumentation modernisiert; vollständiger pi3-Audit integriert (#1, #7).

### 0.0.3 (2022-01-11)
- (joerg) Nicht verwendete Konfigurationsoptionen entfernt und Batteriestromzuordnung korrigiert.

### 0.0.2 (2022-01-11)
- (joerg) Initial release.

## License

MIT License — siehe [LICENSE](LICENSE).
