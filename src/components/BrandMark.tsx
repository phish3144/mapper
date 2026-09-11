/**
 * Das Zeichen von mapper.
 *
 * Bewusst ein <img> auf public/favicon.svg und keine abgeschriebene Kopie
 * der Pfade: das Zeichen steht in Registerkarte, Startbildschirm und
 * Kopfzeile, und es soll an genau EINER Stelle geaendert werden koennen.
 *
 * Ohne Alternativtext, weil daneben immer "mapper" steht - ein zweites Mal
 * vorgelesen zu werden hilft niemandem.
 */
export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      width={size}
      height={size}
      alt=""
      // Damit die Kopfzeile beim Laden nicht springt.
      style={{ display: 'block', flex: 'none', borderRadius: size / 4.5 }}
    />
  )
}
