import React from "react";

export interface CardListProps {
  cards: React.ReactNode[];
}

export default function CardList({ cards }: CardListProps): React.ReactElement {
  return (
    <div
      className={
        "flex flex-col flex-wrap md:flex-row py-10 md:space-x-10 space-y-10"
      }
    >
      {cards}
    </div>
  );
}
