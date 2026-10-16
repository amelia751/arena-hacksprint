/**
 * People are Player 1 and Player 2 on screen. The recorded data keeps them as
 * seat 0 and seat 1, and anything that quotes the schema says so plainly rather
 * than renaming the field.
 */
export function playerName(seat: number): string {
  return `Player ${seat + 1}`;
}
