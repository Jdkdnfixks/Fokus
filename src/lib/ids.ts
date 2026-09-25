let counter = 0;

/** Kurze, zeitlich sortierbare ID */
export function uid(): string {
  counter = (counter + 1) % 1296;
  return (
    Date.now().toString(36) +
    counter.toString(36).padStart(2, "0") +
    Math.floor(Math.random() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")
  );
}
