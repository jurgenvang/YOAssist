/**
 * Eén plaats voor het versienummer. De frontend haalt het op via /api/me, zodat
 * het nooit uit de pas kan lopen met wat er werkelijk draait.
 *
 * Verhoog bij elke deploy die iets aan het gedrag verandert. Dat is niet
 * cosmetisch: als een Youth Official een probleem meldt, wil je weten welke
 * versie hij in zijn browser had.
 */
export const VERSIE = '0.20.1';
