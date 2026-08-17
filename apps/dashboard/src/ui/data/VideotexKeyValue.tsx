export type VideotexKeyValueProps = {
  items: Array<{
    label: string;
    value: string;
  }>;
};

export function VideotexKeyValue({ items }: VideotexKeyValueProps) {
  return (
    <dl className="videotex-key-value">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
