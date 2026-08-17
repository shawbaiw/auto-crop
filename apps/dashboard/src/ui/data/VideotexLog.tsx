export type VideotexLogProps = {
  emptyMessage: string;
  rows: string[];
};

export function VideotexLog({ emptyMessage, rows }: VideotexLogProps) {
  if (rows.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }

  return (
    <ol className="videotex-log">
      {rows.map((row, index) => (
        <li key={`${row}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>{row}</p>
        </li>
      ))}
    </ol>
  );
}
