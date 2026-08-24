/**
 * Draait na de algemene /api/-middleware en vóór elke beheerroute.
 * Eén plaats waar de adminafscherming staat, zodat geen enkele route ze kan
 * vergeten. Het beheermenu in de frontend is enkel gemak; dit is de beveiliging.
 */
export async function onRequest({ data, next }) {
  if (!data.user?.isAdmin) {
    return Response.json(
      { error: 'Geen toegang', detail: 'Deze actie is voorbehouden aan beheerders.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return next();
}
