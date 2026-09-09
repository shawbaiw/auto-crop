export type VideotexKeyValueProps = {
  items: Array<{
    label: string;
    value: string;
  }>;
};

export function VideotexKeyValue({ items }: VideotexKeyValueProps) {
  return (
    <dl className="videotex-key-value">
      {items.map((item, index) => (
        <div key={`${item.label}:${index}`}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
