export function PageSectionHeading(props: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{props.title}</h2>
      <p className="text-sm text-scout-subtle">{props.description}</p>
    </div>
  );
}
