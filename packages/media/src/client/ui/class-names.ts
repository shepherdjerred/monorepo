/**
 * Reads class names from a CSS Module.
 *
 *     const cx = classNames(styles);
 *     <nav className={cx("rail")} />
 *
 * A name the stylesheet does not define is a mistake in the component, so it
 * throws when the component renders instead of leaving an element unstyled.
 */
export function classNames(styles: Readonly<Record<string, string>>) {
  return (name: string): string => {
    const scoped = styles[name];
    if (scoped === undefined) {
      throw new Error(`The stylesheet defines no .${name}`);
    }
    return scoped;
  };
}
