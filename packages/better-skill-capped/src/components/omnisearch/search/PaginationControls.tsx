import React from "react";
import classNames from "classnames/bind";

export interface PaginationControlsProps {
  currentPage: number;
  lastPage: number;
  onPageChange: (newPage: number) => void;
}

interface NumberedPageControlProps {
  page: number;
  isCurrent?: boolean;
  onClick?: () => void;
}

function NumberedPageControl({ page, isCurrent, onClick }: NumberedPageControlProps): React.ReactElement {
  const cx = classNames.bind({});
  return (
    <li key={page}>
      <button
        onClick={onClick}
        className={cx({
          "pagination-link": true,
          button: true,
          "is-current": isCurrent,
        })}
        aria-label={`Page ${String(page)}`}
        aria-current="page"
      >
        {page}
      </button>
    </li>
  );
}

export default function PaginationControls({
  currentPage,
  lastPage,
  onPageChange,
}: PaginationControlsProps): React.ReactElement {
  const firstPage = 1;

  const nextPage = currentPage + 1;
  const previousPage = currentPage - 1;

  const firstToShow = 1;
  const lastToShow = 1;
  const middleToShow = 1;

  const totalToShow = firstToShow + lastToShow + (middleToShow * 2 + 1);

  const numberedControls: React.ReactNode[] = [];

  if (totalToShow < lastPage) {
    for (let i = 1; i <= firstToShow; i++) {
      numberedControls.push(
        <NumberedPageControl
          key={i}
          page={i}
          isCurrent={i === currentPage}
          onClick={() => {
            onPageChange(i);
          }}
        />,
      );
    }

    if (currentPage === firstToShow) {
      numberedControls.push(
        <NumberedPageControl
          key={nextPage}
          page={nextPage}
          isCurrent={nextPage === currentPage}
          onClick={() => {
            onPageChange(nextPage);
          }}
        />,
      );
    }

    if (currentPage > firstToShow + 1 || currentPage < firstToShow + 1) {
      numberedControls.push(
        <li key={"first"}>
          <span className="pagination-ellipsis">&hellip;</span>
        </li>,
      );
    }

    if (currentPage > firstToShow && currentPage < lastPage - lastToShow + 1) {
      for (let i = currentPage - middleToShow; i <= currentPage + middleToShow; i++) {
        if (i <= firstToShow || i >= lastPage - lastToShow + 1) {
          continue;
        }
        numberedControls.push(
          <NumberedPageControl
            key={i}
            page={i}
            isCurrent={i === currentPage}
            onClick={() => {
              onPageChange(i);
            }}
          />,
        );
      }

      if (currentPage > lastPage - lastToShow || currentPage < lastPage - lastToShow) {
        numberedControls.push(
          <li key={"second"}>
            <span className="pagination-ellipsis">&hellip;</span>
          </li>,
        );
      }
    }

    if (currentPage === lastPage - lastToShow + 1) {
      numberedControls.push(
        <NumberedPageControl
          key={previousPage}
          page={previousPage}
          isCurrent={previousPage === currentPage}
          onClick={() => {
            onPageChange(previousPage);
          }}
        />,
      );
    }

    for (let i = lastPage - lastToShow + 1; i <= lastPage; i++) {
      numberedControls.push(
        <NumberedPageControl
          key={i}
          page={i}
          isCurrent={i === currentPage}
          onClick={() => {
            onPageChange(i);
          }}
        />,
      );
    }
  } else {
    for (let i = 1; i < lastPage + 1; i++) {
      numberedControls.push(
        <NumberedPageControl
          key={i}
          page={i}
          isCurrent={i === currentPage}
          onClick={() => {
            onPageChange(i);
          }}
        />,
      );
    }
  }

  const previousButton =
    firstPage === currentPage ? (
      <button
        className="pagination-previous button"
        disabled
        onClick={() => {
          onPageChange(previousPage);
        }}
      >
        Previous
      </button>
    ) : (
      <button
        className="pagination-previous button"
        onClick={() => {
          onPageChange(previousPage);
        }}
      >
        Previous
      </button>
    );

  const nextButton =
    lastPage === currentPage ? (
      <button
        className="pagination-next button"
        disabled
        onClick={() => {
          onPageChange(nextPage);
        }}
      >
        Next page
      </button>
    ) : (
      <button
        className="pagination-next button"
        onClick={() => {
          onPageChange(nextPage);
        }}
      >
        Next page
      </button>
    );

  return (
    <nav className="pagination is-centered" role="navigation" aria-label="pagination">
      {previousButton}
      <ul className="pagination-list">{numberedControls}</ul>
      {nextButton}
    </nav>
  );
}
