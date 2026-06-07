export function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 text-black dark:text-gray-300 divide-y dark:divide-gray-600 divide-gray-200 overflow-hidden rounded-lg shadow">
      <div className="px-4 py-5 sm:px-6">{title}</div>
      <div className="px-4 py-5 sm:p-6">{children}</div>
    </div>
  );
}
