import React from "react";

export interface CardProps {
  header?: React.ReactNode;
  content?: React.ReactNode;
  footer?: React.ReactNode;
}

export default function Card({
  header,
  content,
  footer,
}: CardProps): React.ReactElement {
  const headerWrapper = <div className={"pt-8 pl-8 pr-8"}>{header}</div>;

  const footerWrapper = (
    <div className={"flex-grow pt-8 pl-8 pr-8"}>{footer}</div>
  );

  return (
    <div
      className={
        "shadow rounded-xl bg-white dark:bg-gray-800 dark:text-white flex-1 flex flex-col"
      }
    >
      {headerWrapper}
      <div className={"pl-8 pr-8"}>{content}</div>
      {footerWrapper}
    </div>
  );
}
