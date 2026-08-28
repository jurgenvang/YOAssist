/**
 * Handelen namens iemand anders.
 *
 * Een ouder kan de beschikbaarheid van zijn kinderen invullen. Het kind blijft
 * een gewone rij in `users` met eigen beschikbaarheden, aanduidingen en
 * vergoeding — de ouder krijgt enkel het recht om er namens hem in te vullen.
 *
 * De aangemelde identiteit komt altijd uit Cloudflare Access. Deze module
 * bepaalt alleen of die persoon namens een ander mag handelen, en weigert het
 * zodra de koppeling er niet is. Zonder die controle zou iemand met een
 * aangepast verzoek de beschikbaarheid van een willekeurige official kunnen
 * wijzigen.
 */

/** De kinderen van deze gebruiker, met hun naam. Leeg als er geen zijn. */
export async function kinderenVan(db, ouderEmail) {
  const { results } = await db
    .prepare(
      `SELECT u.email, u.voornaam, u.achternaam, u.profiel
         FROM ouder_kind k
         JOIN users u ON u.email = k.kind_email
        WHERE k.ouder_email = ? AND u.actief = 1
        ORDER BY u.voornaam COLLATE NOCASE, u.achternaam COLLATE NOCASE`,
    )
    .bind(ouderEmail)
    .all()
    .catch(() => ({ results: [] }));

  return results.map((r) => ({
    email: r.email,
    naam: `${r.voornaam} ${r.achternaam}`,
    voornaam: r.voornaam,
    profiel: r.profiel,
  }));
}

/**
 * Bepaalt namens wie er gehandeld wordt.
 *
 * Zonder `namens` is dat de gebruiker zelf. Met `namens` moet er een koppeling
 * bestaan; bestaat die niet, dan wordt het verzoek geweigerd in plaats van
 * stilzwijgend op de eigen rij toegepast — dat laatste zou een wijziging op de
 * verkeerde persoon zetten zonder dat iemand het merkt.
 *
 * @returns {Promise<{email: string, naam: string, namensKind: boolean} | {fout: string}>}
 */
export async function bepaalPersoon(db, user, namens) {
  const gevraagd = String(namens ?? '').trim().toLowerCase();

  if (!gevraagd || gevraagd === user.email.toLowerCase()) {
    return { email: user.email, naam: user.naam, namensKind: false };
  }

  const kind = await db
    .prepare(
      `SELECT u.email, u.voornaam, u.achternaam
         FROM ouder_kind k
         JOIN users u ON u.email = k.kind_email
        WHERE k.ouder_email = ? AND k.kind_email = ? AND u.actief = 1`,
    )
    .bind(user.email, gevraagd)
    .first()
    .catch(() => null);

  if (!kind) {
    return { fout: 'Je mag niet handelen namens deze persoon.' };
  }

  return {
    email: kind.email,
    naam: `${kind.voornaam} ${kind.achternaam}`,
    namensKind: true,
  };
}

/** De ouders van een kind, voor in het beheerscherm. */
export async function oudersVan(db, kindEmail) {
  const { results } = await db
    .prepare(
      `SELECT u.email, u.voornaam, u.achternaam
         FROM ouder_kind k
         JOIN users u ON u.email = k.ouder_email
        WHERE k.kind_email = ?
        ORDER BY u.achternaam COLLATE NOCASE`,
    )
    .bind(kindEmail)
    .all()
    .catch(() => ({ results: [] }));

  return results.map((r) => ({ email: r.email, naam: `${r.voornaam} ${r.achternaam}` }));
}
