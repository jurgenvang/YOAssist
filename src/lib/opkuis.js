/**
 * Dagelijkse opruiming van het logboek en de synchronisatierondes (V33).
 *
 * Zonder opruiming groeien beide onbeperkt: het logboek krijgt een rij bij
 * elke wijziging en beheeractie, `sync_runs` vier rijen per dag plus elke
 * handmatige ronde. Dezelfde aanpak als `kuisBerichtenOp()` in
 * `verwittigen.js`: gewoon wissen, zonder archief — de backup is het archief.
 *
 * Beide functies falen stil: de opkuis mag de rest van de uurtaak nooit
 * laten mislukken.
 */

/** Een jaar: het logboek is de eerste plek bij 'waarom staat dit er zo'. */
export const LOGBOEK_DAGEN = 365;

/** Twee maanden: `sync_runs` is enkel diagnose van de recente rondes. */
export const SYNC_RUNS_DAGEN = 60;

/**
 * Wist afgehandelde logregels ouder dan de bewaartermijn.
 *
 * Nooit wat nog openstaat (`afgehandeld = 0`): een wedstrijdwijziging die
 * niemand bekeek, mag niet stil verdwijnen omdat ze oud is. En nooit de
 * laatste backup-regel: daaruit haalt het beheerscherm 'laatste backup', en
 * wie een jaar geen backup nam, moet dat zien — niet 'nooit'.
 */
export async function kuisLogboekOp(db, dagen = LOGBOEK_DAGEN) {
  const res = await db
    .prepare(
      `DELETE FROM logboek
        WHERE afgehandeld = 1
          AND vastgesteld < datetime('now', ?)
          AND id IS NOT (SELECT MAX(id) FROM logboek WHERE soort = 'backup')`,
    )
    .bind(`-${dagen} days`)
    .run()
    .catch(() => null);
  return res?.meta?.changes ?? 0;
}

/**
 * Wist synchronisatierondes ouder dan de bewaartermijn, behalve de laatste:
 * het beheerscherm toont de meest recente ronde, en na een lange stilte moet
 * daar staan wanneer het laatst lukte, niet 'nooit'.
 */
export async function kuisSyncRunsOp(db, dagen = SYNC_RUNS_DAGEN) {
  const res = await db
    .prepare(
      `DELETE FROM sync_runs
        WHERE gestart < datetime('now', ?)
          AND id IS NOT (SELECT MAX(id) FROM sync_runs)`,
    )
    .bind(`-${dagen} days`)
    .run()
    .catch(() => null);
  return res?.meta?.changes ?? 0;
}
